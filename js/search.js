const SearchManager = {
    init() {
        const input = document.getElementById('schoolSearch');
        const resultBox = document.getElementById('searchResults');
        
        input.addEventListener('keyup', (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { resultBox.style.display = 'none'; return; }
            const matches = MapManager.markers.filter(m => {
                const p = m.properties;
                return !MapManager.isEducationOffice(p) && p.name.includes(val);
            });
            this.renderResults(matches, resultBox);
        });
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-wrapper')) resultBox.style.display = 'none';
        });
    },

    renderResults(matches, container) {
        container.innerHTML = '';
        if (matches.length === 0) { container.style.display = 'none'; return; }
        
        matches.slice(0, 8).forEach(m => {
            const div = document.createElement('div');
            div.className = 'search-item';
            
            // [리팩토링] 하드코딩된 색상 제거 및 공통 클래스 사용
            let typeClass = 'type-default';
            if (m.properties.name.includes('초등학교')) typeClass = 'type-elem';
            else if (m.properties.name.includes('중학교')) typeClass = 'type-mid';
            else if (m.properties.name.includes('고등학교')) typeClass = 'type-high';
            else if (m.properties.name.includes('유치원')) typeClass = 'type-kinder';

            div.innerHTML = `<span>${MapManager.escapeHtml(m.properties.name)}</span><span class="search-item-type ${typeClass}">${MapManager.escapeHtml(m.properties.type)}</span>`;
            
            div.onclick = () => {
                MapManager.focusMarker(m);
                container.style.display = 'none';
                const inputEl = document.getElementById('schoolSearch');
                inputEl.value = m.properties.name;
                inputEl.blur(); 
            };
            container.appendChild(div);
        });
        container.style.display = 'block';
    }
};

const FilterManager = {
    selectedTypes: new Set(),
    selectedDistricts: new Set(),
    selectedEst: new Set(),

    init() {
        document.querySelectorAll('.filter-tag').forEach(tag => {
            tag.onclick = () => {
                const type = tag.getAttribute('data-type');
                tag.classList.toggle('active');
                this.selectedTypes.has(type) ? this.selectedTypes.delete(type) : this.selectedTypes.add(type);
            };
        });
        document.querySelectorAll('.dist-tag').forEach(tag => {
            tag.onclick = () => {
                const dist = tag.getAttribute('data-dist');
                tag.classList.toggle('active');
                this.selectedDistricts.has(dist) ? this.selectedDistricts.delete(dist) : this.selectedDistricts.add(dist);
            };
        });
        document.querySelectorAll('.est-tag').forEach(tag => {
            tag.onclick = () => {
                const est = tag.getAttribute('data-est');
                tag.classList.toggle('active');
                this.selectedEst.has(est) ? this.selectedEst.delete(est) : this.selectedEst.add(est);
            };
        });
    },

    open() { document.getElementById('search-dashboard').style.display = 'flex'; },
    close() { document.getElementById('search-dashboard').style.display = 'none'; },
    
    reset() {
        this.selectedTypes.clear();
        this.selectedDistricts.clear();
        this.selectedEst.clear(); 
        document.querySelectorAll('.filter-tag, .dist-tag, .est-tag').forEach(tag => tag.classList.remove('active'));
        document.getElementById('adv-name-input').value = '';
        ['min-s', 'max-s', 'min-c', 'max-c', 'min-t', 'max-t'].forEach(id => {
            const el = document.getElementById(id); if(el) el.value = '';
        });
    },

    execute() {
        const nameQuery = document.getElementById('adv-name-input').value.trim();
        const getVal = (id, def) => {
            const val = document.getElementById(id)?.value;
            return (val === '' || val == null) ? def : Number(val);
        };
        
        const ranges = {
            s: [getVal('min-s', 0), getVal('max-s', Infinity)],      
            c: [getVal('min-c', 0), getVal('max-c', Infinity)],      
            t: [getVal('min-t', 0), getVal('max-t', Infinity)]
        };

        const filtered = MapManager.markers.filter(m => {
            const p = m.properties;
            if (MapManager.isEducationOffice(p)) return false;
            
            const matchName = !nameQuery || p.name.includes(nameQuery);
            const matchType = this.selectedTypes.size === 0 || this.selectedTypes.has(p.type);
            const estVal = (p.establish || '').trim();
            const matchEst = this.selectedEst.size === 0 || Array.from(this.selectedEst).some(e => estVal === e);
            
            let matchDist = this.selectedDistricts.size === 0 || Array.from(this.selectedDistricts).some(distKey => {
                if (distKey === "오산시") return p.adrs.includes("오산시");
                return MapConfig.DISTRICTS[distKey]?.keywords?.some(k => p.adrs.includes(k));
            });

            const sVal = parseFloat(p.stdnt_cnt) || 0;
            const cVal = parseFloat(p.class_cnt) || 0;
            const tVal = parseFloat(p.tchr_cnt) || 0;

            return matchName && matchType && matchDist && matchEst &&
                   (sVal >= ranges.s[0] && sVal <= ranges.s[1]) &&
                   (cVal >= ranges.c[0] && cVal <= ranges.c[1]) &&
                   (tVal >= ranges.t[0] && tVal <= ranges.t[1]);
        });

        this.close();
        if (filtered.length === 0) {
            alert("조건에 맞는 학교가 없습니다.");
        } else if (filtered.length === 1) {
            const target = filtered[0];
            MapManager.map.flyTo(target.getLatLng(), 16, { duration: 1.5 });
            setTimeout(() => target.openPopup(), 1600);
        } else {
            ResultPageManager.open(filtered); 
        }
    }
};

const ResultPageManager = {
    open(results) {
        const container = document.getElementById('results-list-container');
        const badge = document.getElementById('results-count-badge');
        if (badge) badge.innerText = results.length;
        if (!container) return;

        container.innerHTML = '';
        [...results].sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'ko')).forEach(m => {
            const p = m.properties;
            let typeClass = '';
            if (p.type.includes('유치원')) typeClass = 'type-kinder';
            else if (p.type.includes('초등학교')) typeClass = 'type-elem';
            else if (p.type.includes('중학교')) typeClass = 'type-mid';
            else if (p.type.includes('고등학교')) typeClass = 'type-high';
            else if (p.type.includes('특수')) typeClass = 'type-spec';
            
            const card = document.createElement('div');
            card.className = 'result-card';
            card.innerHTML = `
                <div class="res-type ${typeClass}">${MapManager.escapeHtml(p.type)} ${p.establish ? `· ${MapManager.escapeHtml(p.establish)}` : ''}</div>
                <div class="res-name" title="${MapManager.escapeAttr(p.name)}">${MapManager.escapeHtml(p.name)}</div>
                <div class="res-addr" title="${MapManager.escapeAttr(p.adrs)}">${MapManager.escapeHtml(p.adrs)}</div>
            `;
            card.onclick = () => { this.close(); this.focusSchool(m); };
            container.appendChild(card);
        });
        document.getElementById('search-results-page').style.display = 'flex';
    },
    close() { document.getElementById('search-results-page').style.display = 'none'; },
    focusSchool(marker) {
        MapManager.map.flyTo(marker.getLatLng(), 16, { duration: 1 });
        setTimeout(() => marker.openPopup(), 1100);
    }
};
