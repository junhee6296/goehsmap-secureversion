const MapManager = {
    map: null,
    cluster: null,
    markers: [],
    boundaryGroup: L.layerGroup(),
    activeMarker: null, 
    activeTypeFilters: new Set(),
    lastDistanceMarkerClickAt: 0,
    lastDistanceMarkerClickKey: '',

    init() {
        this.map = L.map('map', { zoomControl: false, minZoom: 10, maxZoom: 18, attributionControl: false });
        this.map.setView(MapConfig.MAP_CENTER, 11);
        this.map.setMaxBounds(MapConfig.BOUNDS);
        
        this.map.createPane('ultraTopPane');
        this.map.getPane('ultraTopPane').style.zIndex = 20000; 

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(this.map);
        this.boundaryGroup.addTo(this.map);

        this.cluster = L.markerClusterGroup({
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 80, 
            disableClusteringAtZoom: 14, 
            singleMarkerMode: false,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();
                let cSize = count >= 50 ? 'red' : count >= 15 ? 'yellow' : 'small';
                return L.divIcon({
                    html: `<div><span>${count}</span></div>`,
                    className: `marker-cluster marker-cluster-${cSize}`,
                    iconSize: [40, 40]
                });
            }
        }).addTo(this.map);

        this.bindEvents();
        this.map.on('contextmenu', () => {
            if (window.DistanceManager && DistanceManager.active && typeof DistanceManager.finish === 'function') {
                DistanceManager.finish();
            }
        });
    },

    getMarkerIcon(p, stackIndex = 0, count = 1) {
        let typeClass = 'is-spec';
        const name = String(p.name || '');
        const type = String(p.type || '');
        let symbolColor = this.safeCssColor(p.color, '#333');
        let stackClass = '';

        if (type.includes('유치') || name.includes('유치원')) { typeClass = 'is-kinder'; }
        else if (type.includes('초등') || name.includes('초등학교')) { typeClass = 'is-elem'; }
        else if (type.includes('중학') || name.includes('중학교')) { typeClass = 'is-mid'; }
        else if (type.includes('고등') || name.includes('고등학교')) { typeClass = 'is-high'; }
        else if (type.includes('특수')) { typeClass = 'is-spec'; }

        if (count > 1) stackClass = `has-stack stack-pos-${stackIndex % 8}`;
        const safeName = this.escapeHtml(name);
        const stackBadge = count > 2 && stackIndex === 0
            ? `<div class="marker-stack-badge">${count > 9 ? '9+' : count}</div>`
            : '';
        const markerShape = this.getMarkerShapeHtml(typeClass);
        
        // 동적 색상은 데이터에서 오므로 CSS 변수로만 전달합니다.
        const html = `
            <div class="custom-combined-marker ${typeClass} ${stackClass}" style="--marker-color:${symbolColor};">
                <div class="marker-label-box">${safeName}</div>
                <div class="marker-symbol" aria-hidden="true">${markerShape}</div>
                ${stackBadge}
            </div>
        `;
        return L.divIcon({ className: 'marker-container-icon', html, iconSize: [0, 0] });
    },

    getMarkerShapeHtml(typeClass) {
        const baseAttrs = 'class="marker-svg" viewBox="0 0 24 24" width="24" height="24" focusable="false"';
        if (typeClass === 'is-kinder') {
            return `<svg ${baseAttrs}><rect class="marker-core" x="5.2" y="5.2" width="13.6" height="13.6" rx="2.8"></rect></svg>`;
        }
        if (typeClass === 'is-elem') {
            return `<svg ${baseAttrs}><polygon class="marker-core" points="12 4.2 20 19.2 4 19.2"></polygon></svg>`;
        }
        if (typeClass === 'is-mid') {
            return `<svg ${baseAttrs}><circle class="marker-core" cx="12" cy="12" r="6.4"></circle></svg>`;
        }
        if (typeClass === 'is-high') {
            return `<svg ${baseAttrs}><polygon class="marker-core" points="12 3.8 14.45 8.8 19.95 9.6 15.95 13.45 16.9 18.9 12 16.25 7.1 18.9 8.05 13.45 4.05 9.6 9.55 8.8"></polygon></svg>`;
        }
        return `<svg ${baseAttrs}><polygon class="marker-core" points="12 4.2 19.8 12 12 19.8 4.2 12"></polygon></svg>`;
    },

    bindEvents() {
        this.map.on('zoomend', () => this.updateZoomState());
        this.updateZoomState();

        const toggleBtn = document.getElementById('toggle-boundary');
        if (toggleBtn) {
            toggleBtn.addEventListener('change', (e) => {
                if (e.target.checked) this.map.addLayer(this.boundaryGroup);
                else this.map.removeLayer(this.boundaryGroup);
            });
        }

        document.addEventListener('click', (event) => {
            const focusBtn = event.target.closest('[data-focus-region]');
            if (focusBtn) this.focusRegion(focusBtn.dataset.focusRegion);
        });

        this.map.on('popupopen', (e) => {
            const popupSource = e.popup?._source;
            if (window.DistanceManager && DistanceManager.active && popupSource?.properties) {
                popupSource.closePopup();
                this.map.closePopup(e.popup);
                return;
            }

            const popupNode = e.popup.getElement();
            requestAnimationFrame(() => {
                this.fitSpecialBusinessList(popupNode);
                requestAnimationFrame(() => this.fitSpecialBusinessList(popupNode));
            });
        });
    },

    updateZoomState() {
        if (!this.map) return;
        const zoom = this.map.getZoom();

        document.querySelectorAll('.dist-stat-btn').forEach(btn => {
            btn.classList.forEach(cls => {
                if (cls.startsWith('zoom-lv-')) btn.classList.remove(cls);
            });
            btn.classList.add(`zoom-lv-${zoom}`);
        });

        const mapContainer = this.map.getContainer();
        if (!mapContainer) return;
        const labelZoom = MapConfig.isSharedMode ? 13 : 15;
        mapContainer.classList.toggle('view-labels-mode', zoom >= labelZoom);
    },

    setTypeFilters(types) {
        this.activeTypeFilters = new Set(types || []);
        this.applyMarkerFilters();
    },

    applyMarkerFilters() {
        this.cluster.clearLayers();

        this.markers.forEach(marker => {
            const p = marker.properties || {};
            const matchesType = this.activeTypeFilters.size === 0 || this.activeTypeFilters.has(p.type);
            if (matchesType) this.cluster.addLayer(marker);
        });
    },

    createMarker(lat, lng, p, stackIndex = 0, count = 1) {
        const isMobile = window.innerWidth <= 768;
        const autoPanPaddingVal = isMobile ? L.point(160, 50) : L.point(80, 50);
        const marker = L.marker([lat, lng], {
            icon: this.getMarkerIcon(p, stackIndex, count),
            zIndexOffset: 100 - stackIndex * 10
        }).bindPopup(this.makePopupHtml(p), {
            className: 'custom-popup',
            pane: 'ultraTopPane', 
            autoPanPadding: L.point(20, 20),
            autoPanPaddingTopLeft: autoPanPaddingVal 
        });
        this.disableAutoPopup(marker);
        this.wireDistanceMarkerDom(marker);
        marker.properties = p;
        marker.on('click', (e) => {
             if (this.handleDistanceMarkerClick(marker, e)) return;
             if (this.activeMarker) this.activeMarker.setZIndexOffset(100); 
             marker.setZIndexOffset(10000); 
             this.activeMarker = marker;
             marker.openPopup();
        });
        return marker;
    },

    disableAutoPopup(marker) {
        if (marker && typeof marker.off === 'function' && marker._openPopup) {
            marker.off('click', marker._openPopup, marker);
        }
    },

    wireDistanceMarkerDom(marker) {
        const bind = () => {
            const icon = marker.getElement?.();
            if (!icon || icon.dataset.distancePickBound === '1') return;

            icon.dataset.distancePickBound = '1';
            const pickPoint = (event) => {
                this.handleDistanceMarkerClick(marker, { originalEvent: event });
            };

            L.DomEvent.on(icon, 'pointerdown', pickPoint, this);
            L.DomEvent.on(icon, 'mousedown', pickPoint, this);
            L.DomEvent.on(icon, 'click', pickPoint, this);
            L.DomEvent.on(icon, 'touchend', pickPoint, this);
        };

        marker.on('add', () => requestAnimationFrame(bind));
        setTimeout(bind, 0);
    },

    handleDistanceMarkerClick(marker, e) {
        if (!window.DistanceManager || !DistanceManager.active || DistanceManager.isPaused) return false;
        if (e?.originalEvent) {
            e.originalEvent.preventDefault?.();
            L.DomEvent.stop(e.originalEvent);
        }
        const latlng = marker.getLatLng();
        const clickKey = `${latlng.lat.toFixed(7)},${latlng.lng.toFixed(7)}`;
        const now = Date.now();
        if (this.lastDistanceMarkerClickKey === clickKey && now - this.lastDistanceMarkerClickAt < 500) return true;

        this.lastDistanceMarkerClickKey = clickKey;
        this.lastDistanceMarkerClickAt = now;

        if (typeof DistanceManager.addPoint === 'function') DistanceManager.addPoint(latlng);
        marker.closePopup();
        if (this.map) this.map.closePopup();
        return true;
    },

    triggerMarkerPopup(e, name) {
        if (e) { e.stopPropagation(); }
        const target = this.markers.find(m => m.properties.name === name);
        if (target) {
            if (this.handleDistanceMarkerClick(target, e ? { originalEvent: e } : null)) return;
            if (this.activeMarker) this.activeMarker.setZIndexOffset(100);
            target.setZIndexOffset(10000);
            this.activeMarker = target;
            target.openPopup(); 
        }
    },

    focusMarker(m) {
        this.map.flyTo(m.getLatLng(), 16, { duration: 1.5 });
        this.map.once('moveend', () => {
            if (this.handleDistanceMarkerClick(m)) return;
            if (this.activeMarker) this.activeMarker.setZIndexOffset(100);
            m.setZIndexOffset(10000);
            this.activeMarker = m;
            m.openPopup();
        });
    },

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    },

    escapeAttr(value) {
        return this.escapeHtml(value).replace(/`/g, '&#96;');
    },

    safeUrl(value) {
        const rawValue = String(value || '').trim();
        if (!/^(https?:\/\/|www\.)/i.test(rawValue)) return '';
        try {
            const normalizedUrl = rawValue.startsWith('www.') ? `https://${rawValue}` : rawValue;
            const url = new URL(normalizedUrl);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch(e) {
            return '';
        }
    },

    safeCssColor(value, fallback = '#333') {
        const color = String(value || '').trim();
        if (/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(color)) return color;
        if (/^(rgb|hsl)a?\([\d\s,%.]+\)$/.test(color)) return color;
        return fallback;
    },

    isEducationOffice(p = {}) {
        const type = String(p.type || '');
        const name = String(p.name || '');
        return type.includes('교육지원청') || name.includes('교육지원청');
    },

    isStatSchool(p = {}) {
        if (this.isEducationOffice(p)) return false;
        const name = String(p.name || '').trim();
        const type = String(p.type || '').trim();
        return !!name && !!type;
    },

    getSpecialBusinessItems(rawValue) {
        return String(rawValue || '')
            .split(/[,，\n]+/)
            .map(item => item.trim())
            .filter(item => item && item !== '-' && item.toLowerCase() !== 'no data');
    },

    getVisualTextLength(text) {
        return Array.from(String(text ?? '')).reduce((total, char) => {
            return total + (/^[\x00-\x7F]$/.test(char) ? 0.58 : 1);
        }, 0);
    },

    getSpecialBusinessFontSize(items) {
        const totalLength = items.reduce((sum, item) => sum + this.getVisualTextLength(item), 0);
        const separatorLength = Math.max(0, items.length - 1) * 1.5;
        const longestLength = Math.max(...items.map(item => this.getVisualTextLength(item)));
        const fitLength = totalLength + separatorLength + Math.max(0, longestLength - 18) * 0.5;

        if (fitLength > 78 || items.length >= 7) return 8;
        if (fitLength > 64 || items.length >= 5) return 8.8;
        if (fitLength > 50 || longestLength > 16) return 9.5;
        return 10.5;
    },

    fitSpecialBusinessList(scope = document) {
        const lists = scope.querySelectorAll('.popup-special-bs-list');
        lists.forEach(list => {
            const chips = [...list.querySelectorAll('.popup-special-bs-badge')];
            if (!chips.length) return;

            const card = list.closest('.popup-special-bs-box');
            const minFontSize = 7.8;
            const baseFontSize = Number(list.dataset.fontSize || 10.5);
            let fontSize = baseFontSize;

            const setFontSize = (size) => {
                list.style.setProperty('--popup-special-bs-font-size', `${size}px`);
            };
            const isOverflowing = () => {
                return list.scrollHeight > list.clientHeight + 1 ||
                    chips.some(chip => chip.scrollWidth > chip.clientWidth + 1);
            };

            if (card) card.classList.remove('is-overflowing');
            setFontSize(fontSize);

            while (fontSize > minFontSize && isOverflowing()) {
                fontSize = Math.max(minFontSize, Number((fontSize - 0.4).toFixed(1)));
                setFontSize(fontSize);
            }

            if (isOverflowing()) {
                if (card) card.classList.add('is-overflowing');
            }
        });
    },

    makeSpecialBusinessHtml(rawValue) {
        const items = this.getSpecialBusinessItems(rawValue);
        if (!items.length) return '';

        const fontSize = this.getSpecialBusinessFontSize(items);
        const itemHtml = items
            .map(item => {
                const safeItem = this.escapeHtml(item);
                return `<span class="popup-special-bs-badge" title="${safeItem}">${safeItem}</span>`;
            })
            .join('');

        return `
                <fieldset class="popup-special-bs-box" aria-label="특색사업">
                    <legend class="popup-special-bs-title">🎨 특색사업</legend>
                    <div class="popup-special-bs-list" aria-label="특색사업명 목록" data-font-size="${fontSize}" style="--popup-special-bs-font-size:${fontSize}px;">${itemHtml}</div>
                </fieldset>`;
    },

    makePopupHtml(p) {
        const safeUrl = this.safeUrl(p.url);
        const linkHtml = safeUrl
            ? `<a href="${this.escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer" class="popup-link-top" title="새 창으로 열기">🏠 홈페이지 이동 ↗</a>`
            : '<span class="popup-link-none">❌ 홈페이지 없음</span>';
            
        const establishText = String(p.establish || '').trim();
        const estBadge = establishText && !this.safeUrl(establishText)
            ? `<span class="badge-est">${this.escapeHtml(establishText)}</span>`
            : '';
        const specialBusinessHtml = this.makeSpecialBusinessHtml(p.special_bs);
        const safeName = this.escapeHtml(p.name || '');
        const safeType = this.escapeHtml(p.type || '학교');
        const safeAddress = this.escapeHtml(p.adrs || '');
        const classCount = Number(p.class_cnt || 0);
        const isSpecialSchool = String(p.type || '').includes('특수') || String(p.name || '').includes('특수학교');
        const specialClassCount = Number(p.special_class_cnt || 0);
        const classLabelHtml = isSpecialSchool
            ? '학급 수'
            : '학급 수 <span class="popup-special-class-label">(특수)</span>';
        const specialClassHtml = isSpecialSchool
            ? ''
            : `<span class="popup-special-class-count">(${specialClassCount.toLocaleString()}학급)</span>`;

        return `
            <div class="popup-content compact-mode">
                <div class="popup-header">
                    <div class="popup-category">${safeType} ${estBadge}</div>
                    ${linkHtml}
                </div>
                <div class="popup-title-row"><h3 class="popup-title">${safeName}</h3></div>
                <div class="popup-adrs">${safeAddress}</div>
                ${specialBusinessHtml}
                <hr class="popup-hr">
                <ul class="popup-info-list popup-school-stats-list">
                    <li class="popup-school-stat stat-students"><span class="label">학생 수</span> <span class="value"><strong>${Number(p.stdnt_cnt || 0).toLocaleString()}</strong>명</span></li>
                    <li class="popup-school-stat stat-classes"><span class="label">${classLabelHtml}</span> <span class="value"><strong>${classCount.toLocaleString()}</strong>학급${specialClassHtml}</span></li>
                    <li class="popup-school-stat stat-teachers"><span class="label">교원 수</span> <span class="value"><strong>${Number(p.tchr_cnt || 0).toLocaleString()}</strong>명</span></li>
                </ul>
            </div>`;
    },

    async loadBoundaries() {
        try {
            const [dongRes, boundaryRes] = await Promise.all([
                fetch('data/hwao.geojson'),
                fetch('data/hwao_boundary.geojson')
            ]);
            if (!dongRes.ok || !boundaryRes.ok) throw new Error();
            const dongData = await dongRes.json();
            const boundaryData = await boundaryRes.json();

            this.boundaryGroup.clearLayers();
            if (!this.map.getPane('boundaryPane')) {
                this.map.createPane('boundaryPane');
                this.map.getPane('boundaryPane').style.zIndex = 250; 
                this.map.getPane('boundaryPane').style.pointerEvents = 'none';
            }
            L.geoJson(dongData, {
                style: (feature) => {
                    const admNm = feature.properties?.adm_nm || '';
                    let fillColor = '#ccc';
                    if (admNm.includes('오산시')) fillColor = MapConfig.DISTRICTS['오산시'].color;
                    else {
                        const guKey = Object.keys(MapConfig.DISTRICTS).find(k => MapConfig.DISTRICTS[k].keywords?.some(w => admNm.includes(w)));
                        fillColor = guKey ? MapConfig.DISTRICTS[guKey].color : MapConfig.DISTRICTS['화성시'].color;
                    }
                    return { fillColor, fillOpacity: 0.35, color: '#ffffff', weight: 2.5, dashArray: '20,5,2,5', pane: 'boundaryPane' };
                }
            }).addTo(this.boundaryGroup);

            L.geoJson(boundaryData, {
                style: (f) => {
                    const sgg = f.properties.sggnm;
                    let hwaseongBorder = '#0047AB';
                    let osanBorder = '#e7733d';
                    
                    if (MapConfig.CustomColors && MapConfig.CustomColors.general) {
                        hwaseongBorder = MapConfig.CustomColors.general.hwaseongBorder;
                        osanBorder = MapConfig.CustomColors.general.osanBorder;
                    }

                    const col = sgg === '화성시' ? hwaseongBorder : sgg === '오산시' ? osanBorder : 'transparent';
                    return { fill: false, color: col, weight: 3, pane: 'boundaryPane' };
                }
            }).addTo(this.boundaryGroup);
        } catch (e) { console.error('경계 로드 실패'); }
    },

    addDistrictButtons() {
        Object.entries(MapConfig.DISTRICTS).forEach(([key, conf]) => {
            if (!conf.pos) return;
            
            let labelName = conf.fullName;
            if (['동탄구', '병점구', '효행구', '만세구'].includes(key)) {
                labelName = key; 
            }
            
            const icon = L.divIcon({
                className: 'district-stat-marker',
                html: `
                        <div class="dist-stat-btn zoom-lv-${this.map.getZoom()}" style="background-color:${this.safeCssColor(conf.color, '#4A90E2')} !important;">
                        <span class="dist-stat-label">${labelName}</span>
                    </div>
                `,
                iconSize: [120, 36]
            });

            // zIndexOffset을 높게 주어 다른 마커들에 파묻히지 않게 고정합니다.
            L.marker(conf.pos, { icon, zIndexOffset: 5000 }).addTo(this.map).on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                this.showDistrictStats(key, conf);
            });
        });
    },

    showDistrictStats(regionKey, config) {
        const keywords = config.keywords || [];
        
        const regionMarkers = this.markers.filter(m => {
            const p = m.properties || {};
            if (!this.isStatSchool(p)) return false;
            let adrs = String(p.adrs || p.address || p['주소'] || p['학교주소'] || "");
            if (!adrs.trim()) adrs = Object.values(p).join(" ");
            
            if (regionKey === '화성시') return adrs.includes('화성');
            if (regionKey === '오산시') return adrs.includes('오산');
            return keywords.some(kw => adrs.includes(kw));
        });

        const totalSchools = regionMarkers.length;
        let totalStudents = 0;
        let totalTeachers = 0;

        regionMarkers.forEach(m => {
            const p = m.properties || {};
            totalStudents += (p.stdnt_cnt || 0);
            totalTeachers += (p.tchr_cnt || 0);
        });

        const fmt = (num) => num.toLocaleString('ko-KR');

        const popupContent = `
            <div class="stat-popup-card">
                <div class="stat-popup-header" style="border-bottom-color: ${this.safeCssColor(config.color, '#4A90E2')};">
                    <span class="stat-popup-title">${this.escapeHtml(config.fullName)}</span>
                </div>
                
                <div class="stat-popup-body">
                    <div class="stat-row">
                        <span class="stat-label">학교 수</span>
                        <span class="stat-value">${fmt(totalSchools)}<span class="stat-unit">개교</span></span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">학생 수</span>
                        <span class="stat-value">${fmt(totalStudents)}<span class="stat-unit">명</span></span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">교원 수</span>
                        <span class="stat-value">${fmt(totalTeachers)}<span class="stat-unit">명</span></span>
                    </div>
                </div>

                <div class="stat-popup-footer">
                    <button class="btn-focus-region" data-focus-region="${this.escapeAttr(regionKey)}">
                        이 지역으로 지도 이동 🔍
                    </button>
                </div>
            </div>
        `;

        // 팝업이 증발하지 않도록 가장 확실하고 안전한 기본 방식으로 띄웁니다.
        L.popup({
            className: 'custom-stat-popup',
            closeButton: true,
            offset: L.point(0, -20),
            autoPan: true
        })
        .setLatLng(config.pos)
        .setContent(popupContent)
        .openOn(this.map);
    },

    focusRegion(key) {
        const conf = MapConfig.DISTRICTS[key];
        if (conf && conf.pos) {
            this.map.setView(conf.pos, 14);
            this.map.closePopup();
        }
    }
};
