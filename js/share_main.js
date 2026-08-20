const ShareApp = {
    hwFill: "#4A90E2",
    osFill: "#FF6392",
    hwBorder: "#0047AB", 
    osBorder: "#e7733d", 

    async init() {
        this.bindUiActions();
        if(MapConfig.loadCustomColors) await MapConfig.loadCustomColors();
        MapConfig.isSharedMode = true; 

        if (MapConfig.CustomColors && MapConfig.CustomColors.shared) {
            this.hwFill = MapConfig.CustomColors.shared.hwaseongFill;
            this.osFill = MapConfig.CustomColors.shared.osanFill;
            this.hwBorder = MapConfig.CustomColors.shared.hwaseongBorder;
            this.osBorder = MapConfig.CustomColors.shared.osanBorder;

            if (!MapConfig.CustomColors.general) MapConfig.CustomColors.general = {};
            MapConfig.CustomColors.general.hwaseongBorder = this.hwBorder;
            MapConfig.CustomColors.general.osanBorder = this.osBorder;
        }

        MapManager.init();
        DistanceManager.init(); 
        
        // [리팩토링] 하드코딩으로 style 태그를 만들어 넣던 로직 제거 (CSS로 이관)

        // 전역 함수 오염 방지를 위해 MapManager 객체 내부로 함수 이동
        MapManager.openSharedPopup = function(uid) {
            const marker = MapManager.markers.find(m => m.properties.uid === uid);
            if (marker) {
                if (MapManager.handleDistanceMarkerClick(marker)) return;
                if (MapManager.activeMarker) MapManager.activeMarker.setZIndexOffset(100);
                marker.setZIndexOffset(10000);
                MapManager.activeMarker = marker;
                marker.openPopup();
            }
        };

        MapManager.showDistrictStats = function() {};
        
        // share_main.js 파일 내부의 addDistrictButtons 함수를 아래 내용으로 교체해주세요!
        
        MapManager.addDistrictButtons = function() {
            Object.entries(MapConfig.DISTRICTS).forEach(([key, conf]) => {
                if (!conf.pos) return;
                const displayName = key === '화성시' ? '화성 다(多)가치' : '오산나래';
                const imgSrc = key === '화성시' ? 'source/coco.png' : 'source/caca.png';
                const imgClass = key === '오산시' ? 'shared-dist-img osan-img' : 'shared-dist-img';

                const icon = L.divIcon({
                    className: 'district-stat-marker',
                    html: `
                        <div class="dist-stat-btn shared-dist-btn zoom-lv-${this.map.getZoom()}" style="background-color:${MapManager.safeCssColor(conf.color, '#4A90E2')} !important;">
                            <img src="${imgSrc}" class="${imgClass}" />
                            <span class="shared-dist-label">${displayName} ↗</span>
                        </div>
                    `,
                    iconSize: [180, 50]
                });
                
                // zIndexOffset 5000 추가!
                L.marker(conf.pos, { icon, zIndexOffset: 5000 }).addTo(this.map).on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (conf.link) window.open(conf.link, '_blank');
                });
            });
        };

        if (typeof MapManager.updateZoomState === 'function') MapManager.updateZoomState();

        MapManager.map.removeLayer(MapManager.cluster);
        MapManager.cluster = L.markerClusterGroup({
            spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true,
            maxClusterRadius: 60, disableClusteringAtZoom: 13, singleMarkerMode: false,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();
                let cSize = count >= 3 ? 'red' : 'small'; 
                return L.divIcon({
                    html: `<div><span>${count}</span></div>`, className: `marker-cluster marker-cluster-${cSize}`, iconSize: [40, 40]
                });
            }
        }).addTo(MapManager.map);

        try {
            const { programs = [], help = null } = await this.fetchPublicData();
            
            if (help) {
                HelpManager.init(help);
                const titleEl = document.getElementById('header-title');
                if (titleEl) titleEl.innerText = '화성오산 공유학교 지도';
            }
            
            MapConfig.DISTRICTS = {
                "화성시": { pos: [37.185, 126.915], color: this.hwFill, fullName: "화성시 전체", keywords: ['화성'], link: "https://gong-u.goe.go.kr/hwaseong/main/view" },
                "오산시": { pos: [37.145, 127.080], color: this.osFill, fullName: "오산시", keywords: ['오산'], link: "https://gong-u.goe.go.kr/osan/main/view" } 
            };

            const groupedSchools = {};
            let uidCounter = 0; 

            programs.forEach((program) => {
                const lat = Number(program.lat);
                const lng = Number(program.lng);
                
                if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;
                
                const adrs = String(program.address || '');
                let region = '기타';
                if (adrs.includes('화성')) region = '화성시';
                if (adrs.includes('오산')) region = '오산시';

                const p = {
                    uid: 'share_school_' + (uidCounter++), 
                    type: program.type || '공유학교', name: program.name || '이름 없음', adrs,
                    duration: program.duration || '-', target: program.target || '-', place: program.place || '-',
                    activity: program.activity || '-', color: '#8E44AD',
                    region: region
                };
                
                const locKey = lat.toFixed(5) + "," + lng.toFixed(5);
                if(!groupedSchools[locKey]) groupedSchools[locKey] = [];
                groupedSchools[locKey].push({lat, lng, p});
            });

            Object.values(groupedSchools).forEach(group => {
                const count = group.length;
                group.forEach((item, index) => {
                    const m = this.createSharedMarker(item.lat, item.lng, item.p, index, count);
                    MapManager.markers.push(m);
                    MapManager.cluster.addLayer(m);
                });
            });
            
            await MapManager.loadBoundaries();
            MapManager.addDistrictButtons(); 
            
            this.initLegend();
            this.initSearch();
        } catch (e) { console.error("데이터 로드 실패:", e); }
    },

    async fetchPublicData() {
        const res = await fetch('/api/share-data', { cache: 'no-store' });
        if (!res.ok) throw new Error('공유학교 데이터 응답 오류');
        return res.json();
    },

    createSharedMarker(lat, lng, p, stackIndex = 0, count = 1) {
        const stackedClass = count > 1 ? 'is-stacked' : '';
        const yOffset = count > 1 ? (stackIndex * 40) - ((count - 1) * 20) : 0; 

        const iconSrc = p.region === '화성시' ? 'source/coco.png' : (p.region === '오산시' ? 'source/caca.png' : '');
        const safeName = MapManager.escapeHtml(p.name);
        const regionClass = p.region === '화성시' ? 'region-hwaseong' : (p.region === '오산시' ? 'region-osan' : 'region-etc');

        const imgClass = p.region === '오산시' ? 'shared-marker-img osan-img' : 'shared-marker-img';
        const imageHtml = iconSrc ? `<img src="${iconSrc}" class="${imgClass}" alt="">` : '';

        const iconHtml = `
            <div class="custom-combined-marker is-shared ${regionClass} ${stackedClass}" style="position: relative; top: ${yOffset}px;">
                <div class="marker-label-box">${safeName}</div>
                ${imageHtml}
            </div>
        `;
        const icon = L.divIcon({ className: 'marker-container-icon', html: iconHtml, iconSize: [0, 0] });

        const marker = L.marker([lat, lng], { icon: icon, zIndexOffset: 100 - stackIndex })
            .bindPopup(this.makeSharedPopupHtml(p), {
                className: 'custom-popup', pane: 'ultraTopPane', autoPanPadding: L.point(20, 20)
            });
        MapManager.disableAutoPopup(marker);
        MapManager.wireDistanceMarkerDom(marker);

        marker.properties = p;
        marker.on('click', (e) => {
            if (MapManager.handleDistanceMarkerClick(marker, e)) return;
            MapManager.openSharedPopup(p.uid);
        });
        
        return marker;
    },

    makeSharedPopupHtml(p) {
        const safeName = MapManager.escapeHtml(p.name);
        const safeType = MapManager.escapeHtml(p.type);
        const safeAddress = MapManager.escapeHtml(p.adrs);
        const safePlace = MapManager.escapeHtml(p.place);
        const safeTarget = MapManager.escapeHtml(p.target);
        const safeDuration = MapManager.escapeHtml(p.duration);
        const safeActivity = MapManager.escapeHtml(p.activity);

        return `
            <div class="popup-content compact-mode">
                <div class="popup-header">
                    <div class="popup-category" style="color:${MapManager.safeCssColor(p.color, '#8E44AD')}">${safeType}</div>
                </div>
                <div class="popup-title-row"><div class="popup-title popup-title-plain">${safeName}</div></div>
                <div class="popup-adrs shared-popup-adrs">${safeAddress}</div>
                <hr class="popup-hr">
                
                <ul class="popup-info-list shared-info-list">
                    <li><span class="label shared-info-label">진행장소</span> <span class="value shared-info-place">${safePlace}</span></li>
                    <li><span class="label shared-info-label">모집대상</span> <span class="value">${safeTarget}</span></li>
                    <li><span class="label shared-info-label">운영기간</span> <span class="value">${safeDuration}</span></li>
                </ul>

                <div class="shared-activity-box">
                    <span class="activity-label">✨ 주요활동</span>
                    <strong class="activity-desc">${safeActivity}</strong>
                </div>

            </div>`;
    },

    initLegend() {
        const container = document.createElement('div');
        container.id = 'share-legend';
        container.innerHTML = `
            <div class="legend-card">
                <div class="legend-header" id="shareLegendToggle">
                    <span class="legend-label">📍 범례</span>
                    <span class="arrow-icon" id="shareLegendArrow">▼</span>
                </div>
                <div class="legend-content" id="shareLegendBody">
                    <div class="legend-reset-row" data-region="전체">↺ 전체 보기</div>
                    
                    <div class="legend-row" data-region="화성시">
                        <img src="source/coco.png" class="legend-region-img" />
                        <span class="l-text fw-bold">화성 다(多)가치</span>
                    </div>
                    
                    <div class="legend-row" data-region="오산시">
                        <img src="source/caca.png" class="legend-region-img osan-legend-img" />
                        <span class="l-text fw-bold">오산나래</span>
                    </div>
                </div>
            </div>
        `;
        document.querySelector('.container').appendChild(container);

        const toggleBtn = document.getElementById('shareLegendToggle');
        const body = document.getElementById('shareLegendBody');
        const arrow = document.getElementById('shareLegendArrow');
        
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            const isCollapsed = body.classList.toggle('collapsed');
            arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        };
        container.querySelectorAll('[data-region]').forEach(row => {
            row.addEventListener('click', (event) => {
                event.stopPropagation();
                this.filterRegion(row.dataset.region);
            });
        });
    },

    filterRegion(region) {
        MapManager.cluster.clearLayers();
        MapManager.markers.forEach(m => {
            if (region === '전체' || m.properties.region === region) {
                MapManager.cluster.addLayer(m);
            }
        });
    },

    initSearch() {
        const input = document.getElementById('schoolSearch');
        const resultBox = document.getElementById('searchResults');
        
        input.addEventListener('keyup', (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { resultBox.style.display = 'none'; return; }
            
            const matches = MapManager.markers.filter(m => m.properties.name.includes(val));
            
            resultBox.innerHTML = '';
            matches.slice(0, 5).forEach(m => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerHTML = `<span>${MapManager.escapeHtml(m.properties.name)}</span> <span class="search-item-type type-shared">${MapManager.escapeHtml(m.properties.type)}</span>`;
                div.onclick = () => {
                    resultBox.style.display = 'none';
                    input.value = m.properties.name;
                    input.blur();
                    MapManager.openSharedPopup(m.properties.uid);
                };
                resultBox.appendChild(div);
            });
            resultBox.style.display = matches.length > 0 ? 'block' : 'none';
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-wrapper')) resultBox.style.display = 'none';
        });
    },

    bindUiActions() {
        document.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            if (action === 'close-help') document.getElementById('helpModal').style.display = 'none';
            if (action === 'toggle-measure') DistanceManager.toggle(target);
        });
    }
};

// [리팩토링] 인라인 스타일 주입을 걷어낸 깔끔한 DistanceManager
const DistanceManager = {
    active: false, isPaused: false, points: [], lines: [], markers: [], tempLine: null, totalDistance: 0, hoverTimer: null, lastRouteOpenAt: 0,
    init() {
        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'btn-pause-measure'; 
        pauseBtn.className = 'btn-pause-measure';
        pauseBtn.innerHTML = '⏸ 일시정지';
        (document.querySelector('.container') || document.body).appendChild(pauseBtn);
        
        document.addEventListener('click', (e) => {
            if (this.handleRouteButtonEvent(e)) return;
            const pBtn = e.target.closest('#btn-pause-measure');
            if (pBtn) { e.preventDefault(); this.togglePause(); }
        });

        document.addEventListener('touchend', (e) => {
            this.handleRouteButtonEvent(e);
        }, { passive: false });
        
        if (MapManager && MapManager.map) {
            MapManager.map.on('click', (e) => {
                if (this.active && !this.isPaused) {
                    MapManager.map.closePopup();
                    this.addPoint(e.latlng);
                }
            });
            MapManager.map.on('mousemove', (e) => { if (this.active && !this.isPaused && this.points.length > 0) this.drawTempLine(e.latlng); });
        }
    },
    handleRouteButtonEvent(e) {
        const routeBtn = e.target.closest?.('[data-route-index]');
        if (!routeBtn) return false;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        const now = Date.now();
        if (now - this.lastRouteOpenAt < 700) return true;
        this.lastRouteOpenAt = now;

        this.openNaverUpTo(Number(routeBtn.dataset.routeIndex));
        return true;
    },
    toggle(btnElem) {
        this.active = !this.active; this.isPaused = false;
        const btn = btnElem || document.getElementById('btn-measure');
        const pauseBtn = document.getElementById('btn-pause-measure');
        const mapEl = document.getElementById('map');
        if (this.active) {
            if (btn) { btn.classList.add('active'); btn.innerHTML = '🛑 중단'; }
            if (pauseBtn) { pauseBtn.style.display = 'block'; pauseBtn.classList.remove('paused'); pauseBtn.innerHTML = '⏸ 일시정지'; }
            if (mapEl) mapEl.classList.add('cursor-crosshair');
            if (MapManager?.map) MapManager.map.closePopup();
            this.clearAll();
        } else {
            if (btn) { btn.classList.remove('active'); btn.innerHTML = '📏 거리재기'; }
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (mapEl) mapEl.classList.remove('cursor-crosshair');
            this.clearAll();
        }
    },
    togglePause() {
        if (!this.active) return;
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('btn-pause-measure');
        const mapEl = document.getElementById('map');
        if (this.isPaused) {
            pauseBtn.classList.add('paused'); pauseBtn.innerHTML = '▶ 그리기 재개';
            if (mapEl) mapEl.classList.remove('cursor-crosshair');
            if (this.tempLine) { MapManager.map.removeLayer(this.tempLine); this.tempLine = null; }
        } else {
            pauseBtn.classList.remove('paused'); pauseBtn.innerHTML = '⏸ 일시정지';
            if (mapEl) mapEl.classList.add('cursor-crosshair');
        }
    },
    addPoint(latlng) {
        this.points.push(latlng);
        const pIndex = this.points.length - 1; 
        if (this.points.length > 1) {
            const prev = this.points[this.points.length - 2];
            this.totalDistance += MapManager.map.distance(prev, latlng); 
            this.lines.push(L.polyline([prev, latlng], { color: '#e74c3c', weight: 3, dashArray: '5, 5' }).addTo(MapManager.map));
        }
        const marker = L.circleMarker(latlng, { radius: 7, color: '#c0392b', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(MapManager.map);
        const distStr = this.formatDistance(this.totalDistance);
        
        const popupHtml = `
            <div id="route-popup-${pIndex}" class="route-popup-box">
                <div class="route-popup-title">이 지점까지 길 찾기</div>
                <button class="btn-naver-route" data-route-index="${pIndex}">네이버 지도 열기 ↗</button>
                <div class="route-popup-warning">※ 경유지는 최대 5개 설정 가능합니다</div>
            </div>`;
        marker.bindPopup(popupHtml, { closeButton: false, autoClose: false, offset: [0, -5] });
        
        const tooltip = marker.bindTooltip(`<div class="tooltip-inner">${this.points.length === 1 ? '출발지' : distStr}</div>`, {
            permanent: true, direction: 'right', className: 'dist-tooltip', interactive: true
        }).openTooltip();
        
        const openAction = () => { clearTimeout(this.hoverTimer); marker.openPopup(); };
        const closeAction = () => { this.hoverTimer = setTimeout(() => { marker.closePopup(); }, 600); };
        marker.on('mouseover', openAction).on('mouseout', closeAction);
        
        setTimeout(() => {
            const tooltipEl = tooltip.getTooltip().getElement();
            if (tooltipEl) { tooltipEl.addEventListener('mouseenter', openAction); tooltipEl.addEventListener('mouseleave', closeAction); }
        }, 50);
        
        marker.on('popupopen', (e) => {
            const node = e.popup.getElement();
            node.addEventListener('mouseenter', openAction); node.addEventListener('mouseleave', closeAction);
        });
        this.markers.push(marker);
    },
    drawTempLine(latlng) {
        if (this.tempLine) MapManager.map.removeLayer(this.tempLine);
        const lastPoint = this.points[this.points.length - 1];
        this.tempLine = L.polyline([lastPoint, latlng], { color: '#e74c3c', weight: 3, dashArray: '5, 5', opacity: 0.5 }).addTo(MapManager.map);
    },
    openNaverUpTo(endIndex) {
        if (!Number.isInteger(endIndex) || endIndex < 1 || this.points.length < 2) return;
        let fullPath = this.points.slice(0, endIndex + 1);
        let finalPoints = [];
        if (fullPath.length <= 7) { finalPoints = fullPath; } 
        else {
            finalPoints.push(fullPath[0]); 
            let mid = fullPath.slice(1, -1);
            let step = (mid.length - 1) / 4;
            for (let i = 0; i < 5; i++) finalPoints.push(mid[Math.round(i * step)]);
            finalPoints.push(fullPath[fullPath.length - 1]); 
        }
        const fmt = (p, name) => `${p.lng},${p.lat},${encodeURIComponent(name)}`;
        let url = "https://map.naver.com/p/directions/";
        const startPt = finalPoints[0];
        const endPt = finalPoints[finalPoints.length - 1];
        const waypoints = finalPoints.slice(1, -1); 
        if (waypoints.length === 0) { url += `${fmt(startPt, '출발지')}/${fmt(endPt, '도착지')}/-/car`; } 
        else {
            const waypointsStr = waypoints.map((p, i) => fmt(p, `경유지${i + 1}`)).join(':');
            url += `${fmt(startPt, '출발지')}/${fmt(endPt, '도착지')}/${waypointsStr}/-/car`;
        }
        const opened = window.open(url, '_blank');
        if (opened) opened.opener = null;
        else window.location.assign(url);
    },
    clearAll() {
        if (MapManager && MapManager.map) {
            this.lines.forEach(l => MapManager.map.removeLayer(l));
            this.markers.forEach(m => MapManager.map.removeLayer(m));
            if (this.tempLine) MapManager.map.removeLayer(this.tempLine);
        }
        this.lines = []; this.markers = []; this.points = []; this.totalDistance = 0; this.tempLine = null;
    },
    finish() { if (this.active) this.toggle(); },
    formatDistance(m) { return m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km'; }
};

document.addEventListener('DOMContentLoaded', () => ShareApp.init());
