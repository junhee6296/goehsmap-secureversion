// js/config.js
const MapConfig = {
    MAP_CENTER: [37.196554, 126.911871],
    BOUNDS: [[36.886521, 126.557641], [37.403725, 127.272064]],
    
    // 서버에서 불러온 커스텀 색상 데이터를 담아둘 객체
    CustomColors: null,

    // 초기값 (서버 로드 실패 시 사용)
    DISTRICTS: {
        "화성시": { pos: [37.185, 126.915], color: "#4A90E2", fullName: "화성시 전체" },
        "오산시": { pos: [37.16361, 127.06229], color: "#FF6392", fullName: "오산시" },
        "동탄구": { pos: [37.198, 127.09], color: "#e9c40e", fullName: "화성시 동탄구", keywords: ['동탄', '오산동'] },
        "병점구": { pos: [37.223, 127.022], color: "#473198", fullName: "화성시 병점구", keywords: ['진안', '병점', '반월', '화산', '안녕', '송산동'] },
        "효행구": { pos: [37.214, 126.925], color: "#3299e7", fullName: "화성시 효행구", keywords: ['봉담', '비봉', '매송', '정남', '기배'] },
        "만세구": { pos: [37.152, 126.892], color: "#a9d1ec", fullName: "화성시 만세구", keywords: ['향남', '우정', '팔탄', '장안', '양감', '마도', '송산면', '서신', '남양', '새솔'] }
    },

    // 앱 초기화 전, 서버에서 색상을 불러와서 DISTRICTS 값을 바꿔치기 하는 함수
    async loadCustomColors() {
        try {
            const res = await fetch('/api/colors');
            if (!res.ok) throw new Error("서버 응답 오류");
            
            this.CustomColors = await res.json();
            
            // 1. 일반 학교 지도 색상 적용 (구조 분해 할당으로 깔끔하게 처리)
            if (this.CustomColors.general) {
                const { dongtanFill, byeongjeomFill, hyohoengFill, manseFill, osanFill } = this.CustomColors.general;
                if (dongtanFill) this.DISTRICTS["동탄구"].color = dongtanFill;
                if (byeongjeomFill) this.DISTRICTS["병점구"].color = byeongjeomFill;
                if (hyohoengFill) this.DISTRICTS["효행구"].color = hyohoengFill;
                if (manseFill) this.DISTRICTS["만세구"].color = manseFill;
                if (osanFill) this.DISTRICTS["오산시"].color = osanFill;
            }
        } catch(e) { 
            console.warn("커스텀 색상 로드 실패 (기본값 사용):", e.message); 
        }
    }
};
