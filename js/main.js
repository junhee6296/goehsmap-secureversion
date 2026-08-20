const App = {
    selectedLegendTypes: new Set(),
    legendTypeColors: new Map(),

    async init() {
        console.log("앱 초기화 시작...");
        this.bindUiActions();
        MapManager.init();
        FilterManager.init();
        SearchManager.init(); 
        DistanceManager.init();
        await MapConfig.loadCustomColors();
        
        try {
            const { schools = [], legend = [], help = null } = await this.fetchPublicData();
            
            if (help) HelpManager.init(help);
            this.buildLegendTypeColors(legend);
            this.renderLegend(legend);
            
            const groupedSchools = {};

            schools.forEach((school) => {
                const lat = Number(school.lat);
                const lng = Number(school.lng);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                
                const type = String(school.type || '');
                const p = {
                    type,
                    name: String(school.name || '이름 없음'), 
                    adrs: String(school.address || ''),
                    establish: String(school.establish || '').trim(),
                    stdnt_cnt: Number(school.studentCount || 0), 
                    tchr_cnt: Number(school.teacherCount || 0),
                    class_cnt: Number(school.classCount || 0),
                    special_class_cnt: Number(school.specialClassCount || 0),
                    color: this.resolveSchoolColor(type, school.color),
                    url: String(school.url || ''),
                    special_bs: String(school.specialBusiness || '').trim()
                };
                
                const locKey = lat.toFixed(5) + "," + lng.toFixed(5);
                if(!groupedSchools[locKey]) groupedSchools[locKey] = [];
                groupedSchools[locKey].push({lat, lng, p});
            });

            Object.values(groupedSchools).forEach(group => {
                group.sort((a, b) => {
                    const getRank = (name) => {
                        if(name.includes('고등')) return 0;
                        if(name.includes('중학')) return 1;
                        if(name.includes('초등')) return 2;
                        if(name.includes('유치')) return 3;
                        return 4;
                    };
                    return getRank(a.p.name) - getRank(b.p.name);
                });
                
                const count = group.length;
                group.forEach((item, index) => {
                    const m = MapManager.createMarker(item.lat, item.lng, item.p, index, count);
                    MapManager.markers.push(m); 
                    MapManager.cluster.addLayer(m);
                });
            });
            
            await MapManager.loadBoundaries();
            MapManager.addDistrictButtons();
            console.log("앱 초기화 완료.");
            
        } catch (e) { 
            console.error("데이터 로드 중 오류 발생:", e); 
        }
    },

    async fetchPublicData() {
        const res = await fetch('/api/map-data', { cache: 'no-store' });
        if (!res.ok) throw new Error('공개 지도 데이터 응답 오류');
        return res.json();
    },

    normalizeType(type) {
        return String(type || '').replace(/\s+/g, '').trim();
    },

    buildLegendTypeColors(rows) {
        this.legendTypeColors.clear();
        if (!Array.isArray(rows)) return;
        rows.forEach(row => {
            const type = row.type;
            if (!type || type === '공유학교') return;
            const color = MapManager.safeCssColor(row.color || '', '');
            if (color) this.legendTypeColors.set(this.normalizeType(type), color);
        });
    },

    resolveSchoolColor(type, rowColor) {
        const normalized = this.normalizeType(type);
        if (this.legendTypeColors.has(normalized)) return this.legendTypeColors.get(normalized);

        const matched = [...this.legendTypeColors.entries()].find(([legendType]) => {
            return normalized.includes(legendType) || legendType.includes(normalized);
        });
        if (matched) return matched[1];

        return MapManager.safeCssColor(rowColor, '#333');
    },

    renderLegend(rows) {
        const container = document.getElementById('legend');
        if (!container) return;
        
        container.innerHTML = `
            <div class="legend-card">
                <div class="legend-header" id="legendToggleBtn">
                    <span class="legend-label">📍 범례</span>
                    <span class="arrow-icon" id="legendArrow">▼</span>
                </div>
                <div class="legend-content" id="legendBody">
                    <div class="legend-reset-row" data-action="legend-reset">↺ 전체 보기</div>
                    <div id="type-list-area"></div>
                </div>
            </div>
        `;

        const toggleBtn = document.getElementById('legendToggleBtn');
        const body = document.getElementById('legendBody');
        const arrow = document.getElementById('legendArrow');

        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            const isCollapsed = body.classList.toggle('collapsed');
            arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        };

        const listArea = document.getElementById('type-list-area');
        rows.forEach(row => {
            const type = row.type;
            if (!type || type === '공유학교') return;
            
            const item = document.createElement('div');
            item.className = 'legend-row';
            item.dataset.type = type;
            const color = MapManager.safeCssColor(row.color || '#333');
            const symbol = MapManager.escapeHtml(row.symbol || '●');
            
            // 데이터별 동적 색상 처리(인라인 허용 구역)
            item.innerHTML = `
                <span class="l-symbol" style="color:${color}">${symbol}</span>
                <span class="l-text">${MapManager.escapeHtml(type)}</span>
            `;
            
            item.onclick = (e) => {
                e.stopPropagation();
                if (this.selectedLegendTypes.has(type)) {
                    this.selectedLegendTypes.delete(type);
                    item.classList.remove('active');
                } else {
                    this.selectedLegendTypes.add(type);
                    item.classList.add('active');
                }
                MapManager.setTypeFilters(this.selectedLegendTypes);
            };
            listArea.appendChild(item);
        });
    },

    resetLegendFilters() {
        this.selectedLegendTypes.clear();
        document.querySelectorAll('#type-list-area .legend-row.active').forEach(item => item.classList.remove('active'));
        MapManager.setTypeFilters(this.selectedLegendTypes);
    },

    bindUiActions() {
        document.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;

            if (action === 'open-filter') FilterManager.open();
            if (action === 'execute-filter') FilterManager.execute();
            if (action === 'close-filter') FilterManager.close();
            if (action === 'reset-filter') FilterManager.reset();
            if (action === 'close-results') ResultPageManager.close();
            if (action === 'close-help') document.getElementById('helpModal').style.display = 'none';
            if (action === 'toggle-measure') DistanceManager.toggle(target);
            if (action === 'legend-reset') this.resetLegendFilters();
        });
    }
};

// =========================================
// 거리재기 및 네이버 길찾기 연동 매니저 
// =========================================
const DistanceManager = {
    active: false,
    isPaused: false,
    points: [],
    lines: [],
    markers: [],
    tempLine: null,
    totalDistance: 0,
    hoverTimer: null,
    lastRouteOpenAt: 0,

    init() {
        // [수정됨] 자바스크립트 내 하드코딩 스타일 주입 로직 완전 제거 -> 외부 CSS로 이관
        
        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'btn-pause-measure';
        pauseBtn.className = 'btn-pause-measure';
        pauseBtn.innerHTML = '⏸ 일시정지';
        const container = document.querySelector('.container') || document.body;
        container.appendChild(pauseBtn);

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
            MapManager.map.on('mousemove', (e) => {
                if (this.active && !this.isPaused && this.points.length > 0) this.drawTempLine(e.latlng);
            });
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
        this.active = !this.active;
        this.isPaused = false;
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
            pauseBtn.classList.add('paused');
            pauseBtn.innerHTML = '▶ 그리기 재개';
            if (mapEl) mapEl.classList.remove('cursor-crosshair');
            if (this.tempLine) { MapManager.map.removeLayer(this.tempLine); this.tempLine = null; }
        } else {
            pauseBtn.classList.remove('paused');
            pauseBtn.innerHTML = '⏸ 일시정지';
            if (mapEl) mapEl.classList.add('cursor-crosshair');
        }
    },

    addPoint(latlng) {
        this.points.push(latlng);
        const pIndex = this.points.length - 1; 
        
        if (this.points.length > 1) {
            const prev = this.points[this.points.length - 2];
            const dist = MapManager.map.distance(prev, latlng); 
            this.totalDistance += dist;
            const line = L.polyline([prev, latlng], { color: '#e74c3c', weight: 3, dashArray: '5, 5' }).addTo(MapManager.map);
            this.lines.push(line);
        }

        const marker = L.circleMarker(latlng, { radius: 7, color: '#c0392b', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(MapManager.map);
        const distStr = this.formatDistance(this.totalDistance);
        
        // [수정됨] 지저분한 인라인 스타일을 깔끔한 클래스로 변경
        const popupHtml = `
            <div id="route-popup-${pIndex}" class="route-popup-box">
                <div class="route-popup-title">이 지점까지 길 찾기</div>
                <button class="btn-naver-route" data-route-index="${pIndex}">네이버 지도 열기 ↗</button>
                <div class="route-popup-warning">※ 경유지는 최대 5개 설정 가능합니다</div>
            </div>
        `;
        marker.bindPopup(popupHtml, { closeButton: false, autoClose: false, offset: [0, -5] });

        const tooltip = marker.bindTooltip(`<div class="tooltip-inner">${this.points.length === 1 ? '출발지' : distStr}</div>`, {
            permanent: true, direction: 'right', className: 'dist-tooltip', interactive: true
        }).openTooltip();

        const openAction = (e) => {
            clearTimeout(this.hoverTimer);
            marker.openPopup();
        };

        const closeAction = (e) => {
            this.hoverTimer = setTimeout(() => { marker.closePopup(); }, 600);
        };

        marker.on('mouseover', openAction).on('mouseout', closeAction);
        
        setTimeout(() => {
            const tooltipEl = tooltip.getTooltip().getElement();
            if (tooltipEl) {
                tooltipEl.addEventListener('mouseenter', openAction);
                tooltipEl.addEventListener('mouseleave', closeAction);
            }
        }, 50);

        marker.on('popupopen', (e) => {
            const node = e.popup.getElement();
            node.addEventListener('mouseenter', openAction);
            node.addEventListener('mouseleave', closeAction);
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

        if (fullPath.length <= 7) {
            finalPoints = fullPath;
        } else {
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

        // 네이버 지도가 인식할 수 있도록 /-/ 구분자 추가
        if (waypoints.length === 0) {
            url += `${fmt(startPt, '출발지')}/${fmt(endPt, '도착지')}/-/car`;
        } else {
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
        this.lines = []; this.markers = []; this.points = [];
        this.totalDistance = 0; this.tempLine = null;
    },

    finish() {
        if (this.active) this.toggle();
    },

    formatDistance(m) {
        return m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km';
    }
};

// [수정됨] 화살표 함수에서 익명 함수로 변경하여 호환성 강화
document.addEventListener('DOMContentLoaded', function() {
    App.init();
});
