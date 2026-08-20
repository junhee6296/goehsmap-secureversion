const SchoolAge3DMap = {
    container: null,
    renderer: null,
    scene: null,
    camera: null,
    mapGroup: null,
    raycaster: null,
    pointer: null,
    meshes: [],
    pickMeshes: [],
    features: [],
    visibleFeatures: [],
    geojson: null,
    boundarySource: '',
    boundaryLevelLabel: '행정동',
    boundaryCandidates: [
        'data/hwao_smallest.geojson',
        'data/hwao_detail.geojson',
        'data/hwao_legal.geojson',
        'data/hwao.geojson'
    ],
    populationData: null,
    populationCache: new Map(),
    populationAbortController: null,
    selectedGroups: ['elementary', 'middle', 'high', 'university'],
    selectedYear: null,
    yearRange: null,
    yearInputTimer: null,
    loadToken: 0,
    lastYearRequestAt: 0,
    animations: [],
    denseOnly: false,
    denseThreshold: 0,
    needsRender: true,
    flatRegionDepth: 0.045,
    maxFeatureValue: 1,
    minFeatureValue: 0,
    groups: [
        { id: 'total', label: '전체', shortLabel: '전체', ageLabel: '6~21세' },
        { id: 'elementary', label: '초등학교', shortLabel: '초등', ageLabel: '6~12세' },
        { id: 'middle', label: '중학교', shortLabel: '중등', ageLabel: '13~15세' },
        { id: 'high', label: '고등학교', shortLabel: '고등', ageLabel: '16~18세' },
        { id: 'university', label: '대학교', shortLabel: '대학', ageLabel: '19~21세' }
    ],
    groupColors: {
        elementary: 0x5aa4f2,
        middle: 0x79bf6b,
        high: 0xf2c04b,
        university: 0xd65d91
    },
    districtColors: {
        dongtan: '#e9c40e',
        byeongjeom: '#473198',
        hyohaeng: '#3299e7',
        manse: '#a9d1ec',
        osan: '#FF6392',
        default: '#60758A'
    },
    districtBorders: {
        hwaseong: '#0047AB',
        osan: '#e7733d',
        default: '#111317'
    },
    drag: { active: false, x: 0, y: 0, moved: false },
    pointers: new Map(),
    gesture: { active: false, distance: 0, cameraY: 0, cameraZ: 0 },
    bounds: null,
    mapOffset: { x: 0, y: 0 },
    hoveredFeature: null,
    async init() {
        this.container = document.getElementById('schoolAgeScene');
        if (!this.container) return;
        if (!window.THREE) {
            this.setStatus('3D 엔진 로드 실패', 'Three.js를 불러오지 못했습니다.');
            return;
        }

        this.setupScene();
        this.bindEvents();
        this.renderAgeSelector();
        await this.loadDistrictColors();
        await this.loadYearRange();
        await this.loadData();
        this.animate();
    },

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x111317, 16, 34);

        this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
        this.camera.position.set(0, -5.4, 13.8);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        this.mapGroup = new THREE.Group();
        this.mapGroup.rotation.x = -0.18;
        this.mapGroup.rotation.z = -0.08;
        this.scene.add(this.mapGroup);

        const ambient = new THREE.AmbientLight(0xffffff, 1.45);
        this.scene.add(ambient);

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.25);
        keyLight.position.set(-5, -8, 12);
        this.scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x7dd3fc, 1.2);
        rimLight.position.set(8, 7, 8);
        this.scene.add(rimLight);

        const floorGeometry = new THREE.CircleGeometry(7.6, 96);
        const floorMaterial = new THREE.MeshBasicMaterial({
            color: 0xc8bfb4,
            transparent: true,
            opacity: 0.22,
            side: THREE.DoubleSide
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.z = -0.03;
        this.mapGroup.add(floor);

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.resize();
    },

    bindEvents() {
        window.addEventListener('resize', () => this.resize());
        const refreshDistrictColors = async () => {
            await this.loadDistrictColors();
            if (this.features.length) {
                this.buildMap();
                this.updatePanel(this.hoveredFeature);
            }
        };
        window.addEventListener('focus', refreshDistrictColors);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refreshDistrictColors();
        });
        document.addEventListener('click', (event) => {
            const group = event.target.closest('[data-group]')?.dataset.group;
            if (group) this.setGroup(group);
            const action = event.target.closest('[data-map-action]')?.dataset.mapAction;
            if (action === 'top') this.setTopView();
            if (action === 'density') this.toggleDensityMode(event.target.closest('[data-map-action]'));
        });

        const yearSlider = document.getElementById('yearSlider');
        if (yearSlider) {
            yearSlider.addEventListener('input', () => {
                this.queueYearChange(yearSlider.value);
            });
            yearSlider.addEventListener('change', () => {
                this.setYear(yearSlider.value, true);
            });
        }

        this.container.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault();
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            this.drag.active = this.pointers.size === 1;
            this.drag.x = event.clientX;
            this.drag.y = event.clientY;
            this.drag.moved = false;
            if (this.pointers.size > 1) {
                this.drag.active = false;
                this.drag.moved = true;
                this.startGesture();
            }
            try {
                this.container.setPointerCapture(event.pointerId);
            } catch (err) {
                // 일부 모바일 브라우저는 캡처가 이미 해제된 포인터에서 예외를 냅니다.
            }
        });
        this.container.addEventListener('pointermove', (event) => {
            if (!this.pointers.has(event.pointerId)) {
                if (event.pointerType !== 'touch') this.updateHover(event);
                return;
            }
            event.preventDefault();
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (this.pointers.size > 1) {
                this.drag.active = false;
                this.drag.moved = true;
                this.updateGesture();
                return;
            }

            if (!this.drag.active) return;
            const dx = event.clientX - this.drag.x;
            const dy = event.clientY - this.drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
            this.mapGroup.rotation.z += dx * 0.004;
            this.mapGroup.rotation.x = this.clamp(this.mapGroup.rotation.x + dy * 0.003, -0.95, 0.08);
            this.drag.x = event.clientX;
            this.drag.y = event.clientY;
            this.requestRender();
        });
        this.container.addEventListener('pointerup', (event) => {
            const shouldSelect = this.drag.active && !this.drag.moved && !this.gesture.active && this.pointers.size <= 1;
            if (shouldSelect) this.selectAt(event);
            this.pointers.delete(event.pointerId);
            if (this.pointers.size === 1) {
                const remaining = [...this.pointers.values()][0];
                this.drag.active = true;
                this.drag.moved = true;
                this.drag.x = remaining.x;
                this.drag.y = remaining.y;
                this.gesture.active = false;
            } else {
                this.drag.active = false;
                this.gesture.active = false;
            }
            try {
                this.container.releasePointerCapture(event.pointerId);
            } catch (err) {
                // 포인터 캡처가 없는 경우는 무시합니다.
            }
        });
        this.container.addEventListener('pointercancel', (event) => {
            this.pointers.delete(event.pointerId);
            if (!this.pointers.size) {
                this.drag.active = false;
                this.gesture.active = false;
            }
        });
        this.container.addEventListener('pointerleave', (event) => {
            if (event.pointerType !== 'touch') {
                this.drag.active = false;
                this.pointers.clear();
            }
            this.clearHover();
        });
        this.container.addEventListener('wheel', (event) => {
            event.preventDefault();
            this.zoomCamera(Math.sign(event.deltaY) * 0.72);
            this.camera.lookAt(0, 0, 0);
            this.requestRender();
        }, { passive: false });
    },

    resize() {
        if (!this.renderer || !this.camera || !this.container) return;
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.requestRender();
    },

    requestRender() {
        this.needsRender = true;
    },

    cancelPopulationRequest() {
        if (this.populationAbortController) {
            this.populationAbortController.abort();
            this.populationAbortController = null;
        }
        this.loadToken += 1;
        this.setLoadingState(false);
    },

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },

    getPointerDistance() {
        const points = [...this.pointers.values()];
        if (points.length < 2) return 0;
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        return Math.hypot(dx, dy);
    },

    startGesture() {
        this.gesture.active = true;
        this.gesture.distance = this.getPointerDistance();
        this.gesture.cameraY = this.camera.position.y;
        this.gesture.cameraZ = this.camera.position.z;
    },

    updateGesture() {
        if (!this.gesture.active) this.startGesture();
        const distance = this.getPointerDistance();
        if (!distance || !this.gesture.distance) return;
        const zoomDelta = (this.gesture.distance - distance) * 0.018;
        this.camera.position.y = this.clamp(this.gesture.cameraY + zoomDelta * 0.9, -17, -0.1);
        this.camera.position.z = this.clamp(this.gesture.cameraZ + zoomDelta, 5.8, 16.5);
        this.camera.lookAt(0, 0, 0);
        this.requestRender();
    },

    zoomCamera(delta) {
        this.camera.position.y = this.clamp(this.camera.position.y + delta * 0.9, -17, -0.1);
        this.camera.position.z = this.clamp(this.camera.position.z + delta, 5.8, 16.5);
        this.requestRender();
    },

    setTopView() {
        this.mapGroup.rotation.x = 0.04;
        this.camera.position.set(0, -0.2, 15.2);
        this.camera.lookAt(0, 0, 0);
        this.requestRender();
    },

    toggleDensityMode(button = null) {
        this.denseOnly = !this.denseOnly;
        if (button) {
            button.classList.toggle('active', this.denseOnly);
            button.setAttribute('aria-pressed', String(this.denseOnly));
        }
        if (this.features.length) this.buildMap();
        this.updatePanel();
    },

    async loadDistrictColors() {
        try {
            const res = await fetch('/api/colors', { cache: 'no-store' });
            if (!res.ok) throw new Error('colors unavailable');
            const colors = await res.json();
            const general = colors?.general || {};
            this.districtColors = {
                ...this.districtColors,
                dongtan: this.safeHex(general.dongtanFill, this.districtColors.dongtan),
                byeongjeom: this.safeHex(general.byeongjeomFill, this.districtColors.byeongjeom),
                hyohaeng: this.safeHex(general.hyohoengFill, this.districtColors.hyohaeng),
                manse: this.safeHex(general.manseFill, this.districtColors.manse),
                osan: this.safeHex(general.osanFill, this.districtColors.osan)
            };
            this.districtBorders = {
                ...this.districtBorders,
                hwaseong: this.safeHex(general.hwaseongBorder, this.districtBorders.hwaseong),
                osan: this.safeHex(general.osanBorder, this.districtBorders.osan)
            };
        } catch (err) {
            // 관리자 색상 파일이 없을 때는 일반 학교 지도 기본 색상을 사용합니다.
        }
    },

    async loadBoundaryGeojson() {
        if (this.geojson) return this.geojson;

        for (const url of this.boundaryCandidates) {
            try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                const geojson = await res.json();
                if (!Array.isArray(geojson.features) || !geojson.features.length) continue;
                this.geojson = geojson;
                this.boundarySource = url;
                this.boundaryLevelLabel = this.detectBoundaryLevel(geojson);
                return geojson;
            } catch (err) {
                // 세부 경계 파일이 없으면 다음 후보로 넘어갑니다.
            }
        }

        throw new Error('geojson failed');
    },

    async loadData(options = {}) {
        const year = String(options.year ?? this.selectedYear ?? '');
        const token = ++this.loadToken;
        try {
            this.setLoadingState(true);
            await this.loadBoundaryGeojson();

            if (!options.force && year && this.populationCache.has(year)) {
                if (token !== this.loadToken) return;
                this.populationData = this.populationCache.get(year);
                this.applyPopulationData({ animate: options.animate !== false });
                return;
            }

            if (this.populationAbortController) this.populationAbortController.abort();
            const controller = new AbortController();
            this.populationAbortController = controller;
            const query = year ? `?year=${encodeURIComponent(year)}` : '';
            const popRes = await fetch(`/api/school-age-population${query}`, {
                cache: 'no-store',
                signal: controller.signal
            }).catch(err => {
                if (err?.name === 'AbortError') return 'aborted';
                return null;
            });
            if (popRes === 'aborted' || token !== this.loadToken || controller.signal.aborted) return;
            if (this.populationAbortController === controller) this.populationAbortController = null;
            this.populationData = popRes && popRes.ok ? await popRes.json() : null;
            if (token !== this.loadToken) return;
            if (year && this.populationData) this.populationCache.set(year, this.populationData);
            this.applyPopulationData({ animate: options.animate !== false });
        } catch (err) {
            if (err?.name !== 'AbortError') this.setStatus('지도 로드 실패', '행정동 경계 데이터를 불러오지 못했습니다.');
        } finally {
            if (token === this.loadToken) this.setLoadingState(false);
        }
    },

    applyPopulationData({ animate = true } = {}) {
        const geojson = this.geojson;
        if (!geojson) return;
        if (Array.isArray(this.populationData?.groups) && this.populationData.groups.length) {
            this.groups = this.populationData.groups;
            this.renderAgeSelector();
        }
        this.features = (geojson.features || []).filter(feature => {
            const props = feature.properties || {};
            const city = this.getFeatureCityName(props);
            const name = this.getFeatureName(props);
            return city.includes('화성시') || city.includes('오산시') || name.includes('화성시') || name.includes('오산시');
        });
        this.attachPopulation();
        if (!this.meshes.length || this.denseOnly) this.buildMap();
        else this.updateMapVisuals({ animate });
        this.updatePanel();
    },

    applyYearPreview(year) {
        if (!this.geojson || !this.features.length) return;
        const cacheKey = String(year);
        if (this.populationCache.has(cacheKey)) {
            this.populationData = this.populationCache.get(cacheKey);
            this.applyPopulationData({ animate: true });
            return;
        }

        const numericYear = Number(year);
        const forecastFromYear = Number(this.yearRange?.forecastFromYear) || (new Date().getFullYear() + 1);
        this.populationData = {
            source: 'local-preview',
            year: numericYear,
            statsYm: String(year),
            forecast: numericYear >= forecastFromYear,
            groups: this.groups,
            message: '연도 이동 중에는 로컬 예측값으로 먼저 갱신하고, 선택을 멈추면 공식 통계를 동기화합니다.'
        };
        this.features.forEach((feature, index) => {
            const props = feature.properties || {};
            props.visualFallback = this.fallbackValue(props, index, year);
            props.groupPopulation = this.normalizeGroupPopulation({}, null, props.visualFallback, props);
            props.schoolAgePopulation = props.groupPopulation.total;
            props.agePopulation = {};
        });
        if (this.denseOnly && !this.meshes.length) this.buildMap();
        else this.updateMapVisuals({ animate: true });
        this.updatePanel();
    },

    scheduleOfficialYearLoad(year, delay = 280) {
        window.clearTimeout(this.yearInputTimer);
        this.yearInputTimer = window.setTimeout(() => {
            this.lastYearRequestAt = window.performance?.now?.() || Date.now();
            this.loadData({ year: String(year) });
        }, delay);
    },

    async loadYearRange() {
        const fallbackObserved = 2024;
        let range = { min: 2000, max: 2072, defaultYear: fallbackObserved, observedYear: fallbackObserved, forecastFromYear: new Date().getFullYear() + 1 };
        try {
            const res = await fetch('/api/school-age-years', { cache: 'no-store' });
            if (res.ok) range = await res.json();
        } catch (err) {
            // 정적 파일로 열 때는 기본 범위를 사용합니다.
        }

        const min = Number(range.min) || 2000;
        const max = Number(range.max) || 2072;
        const defaultYear = Number(range.defaultYear) || max;
        const observedYear = Number(range.observedYear) || defaultYear;
        const forecastFromYear = Number(range.forecastFromYear) || (new Date().getFullYear() + 1);
        this.yearRange = { min, max, defaultYear, observedYear, forecastFromYear };
        this.selectedYear = String(Math.min(max, Math.max(min, defaultYear)));
        this.renderYearSlider();
    },

    renderYearSlider() {
        const slider = document.getElementById('yearSlider');
        if (!slider || !this.yearRange) return;
        slider.min = String(this.yearRange.min);
        slider.max = String(this.yearRange.max);
        slider.value = this.selectedYear;
        slider.disabled = false;
        this.setText('selectedYearLabel', this.selectedYear);
        this.setText('yearMinLabel', `${this.yearRange.min}`);
        this.setText('yearMaxLabel', `${this.yearRange.max}`);
        this.updateYearSliderProgress();
    },

    queueYearChange(year) {
        const nextYear = String(year);
        this.selectedYear = nextYear;
        this.setText('selectedYearLabel', nextYear);
        this.updateYearSliderProgress();
        this.cancelPopulationRequest();
        this.applyYearPreview(nextYear);
        this.scheduleOfficialYearLoad(nextYear);
    },

    async setYear(year, immediate = false) {
        const nextYear = String(year);
        if (nextYear === this.selectedYear && !immediate) return;
        this.selectedYear = nextYear;
        window.clearTimeout(this.yearInputTimer);
        this.lastYearRequestAt = window.performance?.now?.() || Date.now();
        this.setText('selectedYearLabel', nextYear);
        this.updateYearSliderProgress();
        this.cancelPopulationRequest();
        this.applyYearPreview(nextYear);
        if (immediate) await this.loadData({ year: nextYear });
        else this.scheduleOfficialYearLoad(nextYear);
    },

    updateYearSliderProgress() {
        const slider = document.getElementById('yearSlider');
        if (!slider || !this.yearRange) return;
        const min = Number(slider.min);
        const max = Number(slider.max);
        const value = Number(this.selectedYear);
        const progress = max > min ? ((value - min) / (max - min)) * 100 : 100;
        slider.style.setProperty('--year-progress', `${this.clamp(progress, 0, 100)}%`);
    },

    setLoadingState(loading) {
        const slider = document.getElementById('yearSlider');
        if (slider) slider.disabled = !this.yearRange;
        document.body.classList.toggle('is-school-age-loading', loading);
    },

    attachPopulation() {
        const byAdm = new Map();
        const popFeatures = this.populationData?.features || [];
        popFeatures.forEach(feature => {
            const props = feature.properties || {};
            const key = this.getFeatureDataKey(props);
            if (!key) return;
            byAdm.set(key, {
                schoolAgePopulation: Number(props.schoolAgePopulation),
                groupPopulation: props.groupPopulation || {},
                byAge: props.agePopulation || {}
            });
        });

        this.features.forEach((feature, index) => {
            const props = feature.properties || {};
            const record = byAdm.get(this.getFeatureDataKey(props)) || {};
            props.visualFallback = this.fallbackValue(props, index);
            props.groupPopulation = this.normalizeGroupPopulation(
                record.groupPopulation,
                Number.isFinite(record.schoolAgePopulation) ? record.schoolAgePopulation : null,
                props.visualFallback,
                props
            );
            props.schoolAgePopulation = props.groupPopulation.total;
            props.agePopulation = record.byAge || {};
        });
    },

    getFeatureDataKey(props = {}) {
        return String(
            props.featureKey ||
            props.stdgCd ||
            props.admmCd ||
            props.adm_cd2 ||
            props.adm_cd ||
            props.bjd_cd ||
            props.lawd_cd ||
            props.emd_cd ||
            props.EMD_CD ||
            props.LI_CD ||
            props.SIG_CD ||
            this.getFeatureName(props)
        );
    },

    getFeatureName(props = {}) {
        const city = props.sggNm || props.sggnm || props.sgg_nm || props.sig_kor_nm || props.SIG_KOR_NM || '';
        const emd = props.stdgNm || props.dongNm || props.bjd_nm || props.lawd_nm || props.emd_nm || props.EMD_KOR_NM || '';
        const li = props.liNm || props.li_nm || props.LI_KOR_NM || '';
        if (li && emd) return String(`${city ? `${city} ` : ''}${emd} ${li}`).trim();
        return String(
            props.adm_nm ||
            emd ||
            li ||
            props.SIG_KOR_NM ||
            props.name ||
            ''
        );
    },

    getFeatureCityName(props = {}) {
        return String(props.sggNm || props.sggnm || props.sgg_nm || props.sig_kor_nm || props.SIG_KOR_NM || '');
    },

    detectBoundaryLevel(geojson) {
        const keys = new Set((geojson.features || []).flatMap(feature => Object.keys(feature.properties || {})));
        if (['LI_CD', 'LI_KOR_NM', 'li_cd', 'li_nm', 'liNm'].some(key => keys.has(key))) return '법정리';
        if (['stdgCd', 'stdgNm', 'bjd_cd', 'bjd_nm', 'lawd_cd', 'lawd_nm', 'EMD_CD', 'EMD_KOR_NM'].some(key => keys.has(key))) return '법정동·리';
        return '행정동';
    },

    normalizeGroupPopulation(groupPopulation = {}, totalValue = null, fallbackTotal = 1, props = {}) {
        const selectable = this.getSelectableGroups();
        const ratios = this.getFallbackGroupRatios(props);
        const result = {};
        let explicitSum = 0;
        let explicitCount = 0;

        selectable.forEach(group => {
            const value = Number(groupPopulation?.[group.id]);
            if (Number.isFinite(value) && value > 0) {
                result[group.id] = value;
                explicitSum += value;
                explicitCount += 1;
            } else {
                result[group.id] = 0;
            }
        });

        const sourceTotal = Number(groupPopulation?.total ?? totalValue);
        const safeTotal = Number.isFinite(sourceTotal) && sourceTotal > 0
            ? sourceTotal
            : Math.max(1, Number(fallbackTotal) || 1);

        if (explicitCount && explicitCount < selectable.length && safeTotal > explicitSum) {
            const missing = selectable.filter(group => !result[group.id]);
            const missingRatio = missing.reduce((sum, group) => sum + (ratios[group.id] || 0), 0) || missing.length;
            const remainder = safeTotal - explicitSum;
            missing.forEach(group => {
                const ratio = ratios[group.id] || (1 / missing.length);
                result[group.id] = Math.max(0, Math.round(remainder * (ratio / missingRatio)));
            });
        } else if (!explicitCount) {
            let allocated = 0;
            selectable.forEach((group, index) => {
                const isLast = index === selectable.length - 1;
                const value = isLast
                    ? Math.max(0, Math.round(safeTotal - allocated))
                    : Math.max(0, Math.round(safeTotal * (ratios[group.id] || (1 / selectable.length))));
                result[group.id] = value;
                allocated += value;
            });
        }

        result.total = selectable.reduce((sum, group) => sum + (Number(result[group.id]) || 0), 0);
        return result;
    },

    getFallbackGroupRatios(props = {}) {
        const admNm = this.getFeatureName(props);
        const isNewTown = ['동탄', '새솔', '향남', '봉담', '남양'].some(keyword => admNm.includes(keyword));
        const isRural = ['장안', '양감', '팔탄', '마도', '서신', '송산', '비봉', '매송'].some(keyword => admNm.includes(keyword));
        const raw = {
            elementary: isNewTown ? 0.38 : 0.34,
            middle: isNewTown ? 0.18 : 0.19,
            high: isRural ? 0.2 : 0.19,
            university: isRural ? 0.27 : 0.28
        };
        const sum = Object.values(raw).reduce((total, value) => total + value, 0) || 1;
        return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / sum]));
    },

    buildMap() {
        this.clearMap();
        if (!this.features.length) {
            this.visibleFeatures = [];
            this.requestRender();
            return;
        }
        this.bounds = this.computeBounds(this.features);
        this.mapOffset = { x: 0, y: 0 };
        this.visibleFeatures = this.getRenderableFeatures();
        this.updateReliefScale();

        this.visibleFeatures.forEach(feature => {
            const meshes = this.createFeatureMeshes(feature);
            meshes.forEach(mesh => {
                this.meshes.push(mesh);
                this.mapGroup.add(mesh);
            });
        });

        this.requestRender();
    },

    updateMapVisuals({ animate = true } = {}) {
        if (!this.meshes.length) return;
        this.visibleFeatures = this.getRenderableFeatures();
        this.updateReliefScale();
        if (!animate) {
            this.animations = this.animations.filter(animation => {
                const userData = animation.mesh?.userData || {};
                return !userData.regionMesh && !userData.edgeFor;
            });
        }

        this.meshes.forEach(mesh => {
            const feature = mesh.userData?.feature;
            if (!feature) return;
            const depth = this.getFeatureReliefDepth(feature);

            if (mesh.userData?.regionMesh) {
                const color = this.getPopulationColor(feature);
                const baseDepth = mesh.userData.geometryDepth || depth || this.flatRegionDepth;
                const nextScale = baseDepth ? depth / baseDepth : 1;
                mesh.userData.baseColor = color;
                mesh.material?.color?.setHex(color);
                if (mesh.material?.emissive) {
                    mesh.material.emissive.setHex(color);
                    mesh.material.emissive.multiplyScalar(mesh.userData.feature === this.hoveredFeature ? 0.22 : 0.06);
                }
                if (animate) this.animateScaleZ(mesh, nextScale);
                else mesh.scale.z = nextScale;
                return;
            }

            if (mesh.userData?.edgeFor) {
                const baseDepth = mesh.userData.geometryDepth || depth || this.flatRegionDepth;
                const nextScale = baseDepth ? depth / baseDepth : 1;
                if (animate) this.animateScaleZ(mesh, nextScale);
                else mesh.scale.z = nextScale;
                return;
            }

            if (mesh.userData?.labelSprite) {
                mesh.position.z = depth + 0.22;
            }
        });

        this.requestRender();
    },

    clearMap() {
        this.animations = [];
        this.meshes.forEach(mesh => {
            if (mesh.parent) mesh.parent.remove(mesh);
            if (!mesh.userData?.sharedGeometry) mesh.geometry?.dispose();
            this.disposeMaterial(mesh.material);
        });
        this.meshes = [];
        this.pickMeshes = [];
        [...this.mapGroup.children].forEach(child => {
            if (child.userData?.generated) {
                this.mapGroup.remove(child);
                if (!child.userData?.sharedGeometry) child.geometry?.dispose();
                this.disposeMaterial(child.material);
            }
        });
    },

    disposeMaterial(material) {
        if (Array.isArray(material)) {
            material.forEach(item => this.disposeMaterial(item));
            return;
        }
        material?.map?.dispose?.();
        material?.dispose?.();
    },

    getRenderableFeatures() {
        if (!this.denseOnly) return this.features;
        const values = this.features
            .map(feature => this.getFeatureValue(feature))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        if (!values.length) return this.features;
        const index = Math.max(0, Math.floor(values.length * 0.68));
        this.denseThreshold = values[index];
        return this.features.filter(feature => this.getFeatureValue(feature) >= this.denseThreshold);
    },

    updateReliefScale() {
        const values = this.visibleFeatures
            .map(feature => this.getFeatureValue(feature))
            .filter(value => Number.isFinite(value) && value > 0);
        this.maxFeatureValue = values.length ? Math.max(...values) : 1;
        this.minFeatureValue = values.length ? Math.min(...values) : 0;
    },

    getFeatureReliefDepth(feature) {
        const selected = this.getSelectedGroupIds();
        const value = this.getFeatureValue(feature);
        if (!selected.length || !Number.isFinite(value) || value <= 0) return this.flatRegionDepth;
        const min = Math.max(0, this.minFeatureValue || 0);
        const max = Math.max(this.maxFeatureValue || 1, min + 1);
        const normalized = this.clamp((value - min) / (max - min), 0, 1);
        const contrastCurve = Math.pow(normalized, 1.28);
        const admNm = this.getFeatureName(feature.properties || {});
        const dongtanLean = admNm.includes('동탄') ? 1.12 : 1;
        return this.flatRegionDepth + 0.035 + Math.min(1.34, contrastCurve * 1.22 * dongtanLean);
    },

    getPopulationColor(feature) {
        const value = this.getFeatureValue(feature);
        if (!Number.isFinite(value) || value <= 0) return 0xdaf3ff;
        const min = Math.max(0, this.minFeatureValue || 0);
        const max = Math.max(this.maxFeatureValue || 1, min + 1);
        const ratio = max > min ? this.clamp((value - min) / (max - min), 0, 1) : 0.5;
        const curved = Math.pow(ratio, 0.82);
        const color = new THREE.Color(0xdff6ff).lerp(new THREE.Color(0x075ec9), curved);
        return color.getHex();
    },

    getFeatureShortName(props = {}) {
        const li = props.liNm || props.li_nm || props.LI_KOR_NM || '';
        if (li) return String(li).trim();
        const name = this.getFeatureName(props).replace(/\([^)]*\)/g, '').trim();
        const parts = name.split(/\s+/).filter(Boolean);
        return parts[parts.length - 1] || name || this.boundaryLevelLabel;
    },

    createFeatureLabel(feature, depth) {
        const center = this.getFeatureCenter(feature);
        const labelText = this.getFeatureShortName(feature.properties || {});
        if (!labelText) return null;
        const canvas = document.createElement('canvas');
        const width = 256;
        const height = 92;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.clearRect(0, 0, width, height);
        ctx.font = '800 28px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const measured = Math.min(width - 34, Math.max(82, ctx.measureText(labelText).width + 32));
        const boxX = (width - measured) / 2;
        const boxY = 20;
        const boxH = 50;
        ctx.fillStyle = 'rgba(240, 249, 255, 0.88)';
        ctx.strokeStyle = 'rgba(7, 94, 201, 0.42)';
        ctx.lineWidth = 2;
        this.roundRect(ctx, boxX, boxY, measured, boxH, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#073763';
        ctx.fillText(labelText, width / 2, boxY + boxH / 2 + 1, measured - 22);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(center.x, center.y, depth + 0.22);
        const scale = this.clamp(measured / 150, 0.62, 1.25);
        sprite.scale.set(scale, scale * 0.36, 1);
        sprite.userData = { feature, generated: true, labelSprite: true };
        return sprite;
    },

    roundRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    getSelectedGroupTotals(features = this.visibleFeatures) {
        const selected = this.getSelectedGroupIds();
        return selected.map(groupId => ({
            id: groupId,
            value: features.reduce((sum, feature) => {
                const value = Number(feature.properties?.groupPopulation?.[groupId]);
                return sum + (Number.isFinite(value) ? value : 0);
            }, 0)
        })).filter(item => item.value > 0);
    },

    getSelectedGroupsGradient(features = this.visibleFeatures) {
        const totals = this.getSelectedGroupTotals(features);
        const total = totals.reduce((sum, item) => sum + item.value, 0);
        if (!totals.length || !total) return 'linear-gradient(90deg, #60758a, #60758a)';
        let cursor = 0;
        const stops = [];
        totals.forEach(item => {
            const next = cursor + (item.value / total) * 100;
            const color = `#${(this.groupColors[item.id] || 0xffffff).toString(16).padStart(6, '0')}`;
            stops.push(`${color} ${cursor.toFixed(2)}%`, `${color} ${next.toFixed(2)}%`);
            cursor = next;
        });
        return `linear-gradient(90deg, ${stops.join(', ')})`;
    },

    createFeatureMeshes(feature) {
        const props = feature.properties || {};
        const color = this.getPopulationColor(feature);
        const borderColor = this.getRegionBorderColor(props);
        const depth = this.getFeatureReliefDepth(feature);
        const meshes = [];

        this.getPolygons(feature.geometry).forEach(polygon => {
            const shape = this.polygonToShape(polygon);
            if (!shape) return;
            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth,
                bevelEnabled: true,
                bevelSize: 0.01,
                bevelThickness: 0.015,
                bevelSegments: 2
            });
            geometry.computeVertexNormals();
            const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
                color,
                roughness: 0.64,
                metalness: 0.04,
                emissive: new THREE.Color(color).multiplyScalar(0.045)
            }));
            mesh.userData = {
                feature,
                baseColor: color,
                geometryDepth: depth,
                isRegion: true,
                regionMesh: true,
                generated: true
            };
            meshes.push(mesh);
            this.pickMeshes.push(mesh);
            this.animateMeshIntro(mesh);

            const edgeGeometry = new THREE.EdgesGeometry(geometry, 34);
            const edge = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: borderColor, transparent: true, opacity: 0.4 }));
            edge.userData = { feature, geometryDepth: depth, isRegion: true, generated: true, edgeFor: mesh };
            meshes.push(edge);
            this.animateMeshIntro(edge);
        });

        if (meshes.some(mesh => mesh.userData?.regionMesh)) {
            const label = this.createFeatureLabel(feature, depth);
            if (label) meshes.push(label);
        }
        return meshes;
    },

    polygonToShape(polygon) {
        if (!Array.isArray(polygon?.[0]) || polygon[0].length < 3) return null;
        const outer = polygon[0].map(coord => this.project(coord));
        const shape = new THREE.Shape();
        outer.forEach((point, index) => {
            if (index === 0) shape.moveTo(point.x, point.y);
            else shape.lineTo(point.x, point.y);
        });
        shape.closePath();
        polygon.slice(1).forEach(ring => {
            if (!Array.isArray(ring) || ring.length < 3) return;
            const hole = new THREE.Path();
            ring.forEach((coord, index) => {
                const point = this.project(coord);
                if (index === 0) hole.moveTo(point.x, point.y);
                else hole.lineTo(point.x, point.y);
            });
            hole.closePath();
            shape.holes.push(hole);
        });
        return shape;
    },

    project(coord) {
        const [lng, lat] = coord;
        const width = this.bounds.maxLng - this.bounds.minLng || 1;
        const height = this.bounds.maxLat - this.bounds.minLat || 1;
        return {
            x: ((lng - this.bounds.minLng) / width - 0.5) * 11.5,
            y: ((lat - this.bounds.minLat) / height - 0.5) * 7.2
        };
    },

    computeBounds(features) {
        const bounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
        features.forEach(feature => {
            this.walkCoords(feature.geometry?.coordinates, coord => {
                bounds.minLng = Math.min(bounds.minLng, coord[0]);
                bounds.maxLng = Math.max(bounds.maxLng, coord[0]);
                bounds.minLat = Math.min(bounds.minLat, coord[1]);
                bounds.maxLat = Math.max(bounds.maxLat, coord[1]);
            });
        });
        return bounds;
    },

    walkCoords(coords, visitor) {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            visitor(coords);
            return;
        }
        coords.forEach(child => this.walkCoords(child, visitor));
    },

    getPolygons(geometry) {
        if (!geometry) return [];
        if (geometry.type === 'Polygon') return [geometry.coordinates];
        if (geometry.type === 'MultiPolygon') return geometry.coordinates;
        return [];
    },

    getFeatureCenter(feature) {
        let totalX = 0;
        let totalY = 0;
        let count = 0;
        this.walkCoords(feature.geometry?.coordinates, coord => {
            const point = this.project(coord);
            totalX += point.x;
            totalY += point.y;
            count += 1;
        });
        return count
            ? {
                x: totalX / count - (this.mapOffset?.x || 0),
                y: totalY / count - (this.mapOffset?.y || 0)
            }
            : { x: 0, y: 0 };
    },

    getFeatureValue(feature) {
        const props = feature.properties || {};
        const selected = this.getSelectedGroupIds();
        if (!selected.length) return 0;
        const groupPopulation = props.groupPopulation || {};
        const selectedTotal = selected.reduce((sum, groupId) => {
            const value = Number(groupPopulation[groupId]);
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
        const hasSelectedGroupData = selected.some(groupId => Object.prototype.hasOwnProperty.call(groupPopulation, groupId));
        if (hasSelectedGroupData) return selectedTotal;
        const total = Number(groupPopulation.total ?? props.schoolAgePopulation);
        if (Number.isFinite(total) && total > 0) {
            return this.isAllGroupsSelected() ? total : total * (selected.length / Math.max(1, this.getSelectableGroups().length));
        }
        return props.visualFallback || 1;
    },

    fallbackValue(props, index, yearOverride = this.selectedYear) {
        const admNm = this.getFeatureName(props);
        const seed = Array.from(String(admNm || this.getFeatureDataKey(props) || index)).reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const sggNm = this.getFeatureCityName(props);
        const base = 900 + (seed % 4200);
        const isOsan = sggNm.includes('오산');
        const isNewTown = ['동탄', '새솔', '향남', '봉담', '남양'].some(keyword => admNm.includes(keyword));
        const isRural = ['장안', '양감', '팔탄', '마도', '서신', '송산', '비봉', '매송'].some(keyword => admNm.includes(keyword));
        const cityFactor = isOsan ? 0.82 : 1.08;
        const townFactor = isNewTown ? 1.36 : (isRural ? 0.62 : 1);
        const year = Number(yearOverride) || 2024;
        const yearsFromBase = year - 2024;
        const pastFactor = yearsFromBase < 0 ? Math.max(0.72, 1 + yearsFromBase * 0.012) : 1;
        const futureFactor = yearsFromBase > 0
            ? (isOsan ? Math.max(0.72, 1 - yearsFromBase * 0.006) : Math.max(0.82, 1 + Math.min(yearsFromBase, 12) * 0.018 - Math.max(0, yearsFromBase - 12) * 0.006))
            : 1;
        return Math.max(1, Math.round(base * cityFactor * townFactor * pastFactor * futureFactor));
    },

    safeHex(value, fallback) {
        return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
    },

    hexToNumber(value, fallback = 0x60758a) {
        const safe = this.safeHex(value, null);
        return safe ? Number.parseInt(safe.slice(1), 16) : fallback;
    },

    getDistrictKey(props) {
        const admNm = this.getFeatureName(props);
        const sgg = this.getFeatureCityName(props);
        if (sgg.includes('오산')) return 'osan';
        if (['동탄', '오산동'].some(keyword => admNm.includes(keyword))) return 'dongtan';
        if (['진안', '병점', '반월', '화산', '안녕', '송산동'].some(keyword => admNm.includes(keyword))) return 'byeongjeom';
        if (['봉담', '비봉', '매송', '정남', '기배'].some(keyword => admNm.includes(keyword))) return 'hyohaeng';
        if (['향남', '우정', '팔탄', '장안', '양감', '마도', '송산면', '서신', '남양', '새솔'].some(keyword => admNm.includes(keyword))) return 'manse';
        return 'default';
    },

    getRegionColor(props) {
        const key = this.getDistrictKey(props);
        return this.hexToNumber(this.districtColors[key] || this.districtColors.default);
    },

    getRegionBorderColor(props) {
        const sgg = this.getFeatureCityName(props);
        const key = sgg.includes('오산') ? 'osan' : (sgg.includes('화성') ? 'hwaseong' : 'default');
        return this.hexToNumber(this.districtBorders[key] || this.districtBorders.default, 0x111317);
    },

    getSelectedGroup() {
        const selected = this.getSelectedGroupIds();
        if (!selected.length) {
            return {
                id: 'none',
                label: '선택 없음',
                shortLabel: '없음',
                ageLabel: '학령 구간 미선택'
            };
        }
        if (selected.length === this.getSelectableGroups().length) return this.groups[0];
        if (selected.length === 1) return this.groups.find(group => group.id === selected[0]) || this.groups[0];
        return {
            id: 'custom',
            label: selected.map(groupId => this.groups.find(group => group.id === groupId)?.shortLabel || groupId).join('+'),
            shortLabel: '선택',
            ageLabel: '복수 구간'
        };
    },

    getSelectableGroups() {
        return this.groups.filter(group => group.id !== 'total');
    },

    getSelectedGroupIds() {
        const validIds = new Set(this.getSelectableGroups().map(group => group.id));
        return this.selectedGroups.filter(groupId => validIds.has(groupId));
    },

    isAllGroupsSelected() {
        const selectedLength = this.getSelectedGroupIds().length;
        return selectedLength > 0 && selectedLength === this.getSelectableGroups().length;
    },

    renderAgeSelector() {
        const selector = document.getElementById('ageSelector');
        if (!selector) return;
        selector.replaceChildren(...this.groups.map(group => {
            const chip = document.createElement('button');
            chip.type = 'button';
            const active = group.id === 'total' ? this.isAllGroupsSelected() : this.getSelectedGroupIds().includes(group.id);
            chip.className = `age-chip ${active ? 'active' : ''}`;
            chip.dataset.group = group.id;
            chip.textContent = group.id === 'total' ? '전체' : `${group.label} (${group.ageLabel})`;
            return chip;
        }));
    },

    setGroup(group) {
        const selectable = this.getSelectableGroups().map(item => item.id);
        if (group === 'total') {
            this.selectedGroups = this.isAllGroupsSelected() ? [] : selectable;
        } else if (selectable.includes(group)) {
            const current = new Set(this.selectedGroups.filter(groupId => selectable.includes(groupId)));
            if (current.has(group)) current.delete(group);
            else current.add(group);
            this.selectedGroups = selectable.filter(groupId => current.has(groupId));
        }
        this.renderAgeSelector();
        if (this.features.length) {
            this.buildMap();
            this.updatePanel();
        }
    },

    updatePanel(feature = null) {
        const source = this.populationData?.source || 'mois-pending';
        const kosis = source.startsWith('kosis');
        const live = source === 'kosis-live' || source === 'mois-jumin-csv' || source === 'data-go-kr-live';
        const model = source === 'kosis-model' || source === 'mois-model';
        const panelFeatures = this.denseOnly ? this.visibleFeatures : this.features;
        const values = panelFeatures.map(item => this.getFeatureValue(item)).filter(Number.isFinite);
        const total = values.reduce((sum, value) => sum + value, 0);
        const selected = feature?.properties || null;
        const selectedGroup = this.getSelectedGroup();
        const noSelection = selectedGroup.id === 'none';
        const forecast = !!this.populationData?.forecast;

        const visibleCount = this.visibleFeatures?.length || this.features.length;
        this.setText('populationDongCount', visibleCount ? `${visibleCount}개` : '-');
        this.setText('populationYear', this.populationData?.statsYm || this.populationData?.year || '-');
        this.setText(
            'populationStatusTitle',
            live
                ? (kosis ? 'KOSIS 학령인구 동기화' : '행안부 주민등록 동기화')
                : (model ? (kosis ? 'KOSIS 기준 예측 모델' : '주민등록 기준 예측 모델') : '공식 통계 연동 대기')
        );
        this.setText(
            'populationStatusText',
            live
                ? `초등·중등·고등·대학 연령대 값을 ${this.boundaryLevelLabel} 단위로 반영했습니다.${forecast ? ' 현재 연도 이후라 예측값으로 표시됩니다.' : ''}`
                : (this.populationData?.message || 'KOSIS 또는 행안부 통계가 연결되면 공식 값으로 높이가 갱신됩니다.')
        );
        this.setText('selectedRegionName', selected ? (this.getFeatureName(selected) || this.boundaryLevelLabel) : '화성·오산 전체');
        this.setText(
            'selectedRegionMeta',
            selected
                ? this.getFeatureLabel({ properties: selected })
                : (noSelection
                    ? `학령군을 선택하면 지역색 블록 높이가 해당 합계로 조절됩니다.${this.denseOnly ? ` 현재 상위 밀집동 ${visibleCount}개만 표시 중입니다.` : ''}`
                    : `${selectedGroup.label} 구간의 합계로 지역색 블록 높이를 조절합니다.${this.denseOnly ? ` 현재 상위 밀집동 ${visibleCount}개만 표시 중입니다.` : ''}`)
        );
        this.setText('totalPopulationLabel', `${noSelection ? '선택 없음' : `${selectedGroup.label} 합계`}${forecast ? ' (예측)' : ''}`);
        this.setText('totalPopulation', values.length ? `${this.format(total)}명` : '-');
        const fill = document.getElementById('rangeBarFill');
        if (fill) {
            fill.style.width = values.length && total > 0 ? '100%' : '0%';
            fill.style.background = this.getSelectedGroupsGradient(panelFeatures);
        }
    },

    setStatus(title, text) {
        this.setText('populationStatusTitle', title);
        this.setText('populationStatusText', text);
    },

    updateHover(event) {
        if (!this.renderer || !this.camera || this.drag.active) return;
        const feature = this.getFeatureAt(event);
        if (!feature) {
            this.clearHover();
            return;
        }
        if (this.hoveredFeature !== feature) {
            this.setHighlight(feature);
            this.updatePanel(feature);
        }
        this.showHover(event, feature);
    },

    selectAt(event) {
        const feature = this.getFeatureAt(event);
        if (!feature) return;
        this.setHighlight(feature);
        this.updatePanel(feature);
        this.showHover(event, feature);
    },

    getFeatureAt(event) {
        if (!this.renderer || !this.camera || !this.pickMeshes.length) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObjects(this.pickMeshes, false)[0];
        return hit?.object?.userData?.feature || null;
    },

    setHighlight(feature) {
        this.meshes.forEach(mesh => {
            if (!mesh.userData?.regionMesh || !mesh.material?.emissive) return;
            mesh.material.emissive.setHex(mesh.userData.baseColor);
            mesh.material.emissive.multiplyScalar(mesh.userData.feature === feature ? 0.22 : 0.06);
        });
        this.hoveredFeature = feature;
        this.requestRender();
    },

    clearHover() {
        const card = document.getElementById('hoverCard');
        if (card) card.hidden = true;
        this.meshes.forEach(mesh => {
            if (!mesh.userData?.regionMesh || !mesh.material?.emissive) return;
            mesh.material.emissive.setHex(mesh.userData.baseColor);
            mesh.material.emissive.multiplyScalar(0.06);
        });
        this.hoveredFeature = null;
        this.updatePanel();
        this.requestRender();
    },

    showHover(event, feature) {
        const card = document.getElementById('hoverCard');
        if (!card) return;
        card.hidden = false;
        card.style.left = `${event.clientX - this.container.getBoundingClientRect().left}px`;
        card.style.top = `${event.clientY - this.container.getBoundingClientRect().top}px`;
        this.setText('hoverRegion', this.getFeatureName(feature.properties || {}) || this.boundaryLevelLabel);
        this.setText('hoverValue', this.getFeatureLabel(feature));
        this.renderHoverBreakdown(feature);
    },

    getFeatureLabel(feature) {
        const props = feature.properties || {};
        const group = this.getSelectedGroup();
        const value = this.getFeatureValue(feature);
        const suffix = this.populationData?.forecast ? ' 예측' : '';
        if (group.id === 'none') return '학령 구간 선택 없음';
        return Number.isFinite(value)
            ? `${group.label} ${this.format(value)}명${suffix}`
            : `${group.label} 데이터 대기`;
    },

    renderHoverBreakdown(feature) {
        const list = document.getElementById('hoverBreakdown');
        if (!list) return;
        const props = feature.properties || {};
        const selected = new Set(this.getSelectedGroupIds());
        const selectedTotal = [...selected].reduce((sum, groupId) => {
            const value = Number(props.groupPopulation?.[groupId]);
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
        const total = selectedTotal || Number(props.groupPopulation?.total ?? props.schoolAgePopulation) || 0;
        const rows = this.groups
            .filter(group => group.id !== 'total')
            .map(group => {
                const rawValue = Number(props.groupPopulation?.[group.id]);
                const numericValue = Number.isFinite(rawValue) ? rawValue : 0;
                const ratio = selected.has(group.id) && total ? numericValue / total : 0;
                const row = document.createElement('div');
                row.className = `hover-breakdown-row ${selected.has(group.id) ? 'active' : ''}`;
                row.style.setProperty('--share-color', `#${(this.groupColors[group.id] || 0xffffff).toString(16).padStart(6, '0')}`);
                row.style.setProperty('--share-width', `${Math.round(ratio * 100)}%`);

                const label = document.createElement('span');
                label.textContent = `${group.shortLabel || group.label} (${group.ageLabel})`;

                const value = document.createElement('strong');
                value.textContent = `${this.format(numericValue)}명 · ${Math.round(ratio * 100)}%`;

                const bar = document.createElement('i');
                row.append(label, value, bar);
                return row;
            });
        list.replaceChildren(...rows);
    },

    setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    format(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return Math.round(num).toLocaleString('ko-KR');
    },

    animateMeshIntro(mesh) {
        mesh.scale.z = 0.08;
        this.animations.push({
            kind: 'intro',
            mesh,
            start: window.performance?.now?.() || Date.now(),
            duration: 560,
            fromZ: 0.08,
            toZ: 1
        });
        this.requestRender();
    },

    animateScaleZ(mesh, toZ, duration = 260) {
        if (!mesh || !Number.isFinite(toZ) || toZ <= 0) return;
        const now = window.performance?.now?.() || Date.now();
        const fromZ = this.resolveScaleAnimation(mesh, now);
        if (Math.abs(fromZ - toZ) < 0.01) {
            mesh.scale.z = toZ;
            this.animations = this.animations.filter(animation => animation.mesh !== mesh);
            return;
        }
        this.animations = this.animations.filter(animation => animation.mesh !== mesh);
        this.animations.push({
            kind: 'year-scale',
            mesh,
            start: now,
            duration,
            fromZ,
            toZ
        });
        this.requestRender();
    },

    resolveScaleAnimation(mesh, now = window.performance?.now?.() || Date.now()) {
        const animation = this.animations.find(item => item.mesh === mesh);
        if (!animation) return mesh.scale.z;
        const progress = this.clamp((now - animation.start) / animation.duration, 0, 1);
        const eased = animation.kind === 'year-scale'
            ? this.easeInOutCubic(progress)
            : this.easeOutCubic(progress);
        const fromZ = Number.isFinite(animation.fromZ) ? animation.fromZ : mesh.scale.z;
        const toZ = Number.isFinite(animation.toZ) ? animation.toZ : mesh.scale.z;
        const currentZ = fromZ + (toZ - fromZ) * eased;
        mesh.scale.z = currentZ;
        return currentZ;
    },

    easeOutCubic(value) {
        const t = this.clamp(value, 0, 1);
        return 1 - Math.pow(1 - t, 3);
    },

    easeInOutCubic(value) {
        const t = this.clamp(value, 0, 1);
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },

    updateAnimations() {
        if (!this.animations.length) return;
        const now = window.performance?.now?.() || Date.now();
        this.animations = this.animations.filter(animation => {
            if (!animation.mesh?.parent) return false;
            const progress = this.clamp((now - animation.start) / animation.duration, 0, 1);
            const eased = animation.kind === 'year-scale'
                ? this.easeInOutCubic(progress)
                : this.easeOutCubic(progress);
            const fromZ = Number.isFinite(animation.fromZ) ? animation.fromZ : 0.08;
            const toZ = Number.isFinite(animation.toZ) ? animation.toZ : 1;
            animation.mesh.scale.z = fromZ + (toZ - fromZ) * eased;
            this.needsRender = true;
            return progress < 1;
        });
    },

    animate() {
        requestAnimationFrame(() => this.animate());
        this.updateAnimations();
        if (!this.renderer || !this.scene || !this.camera || !this.needsRender) return;
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
    }
};

document.addEventListener('DOMContentLoaded', () => SchoolAge3DMap.init());
