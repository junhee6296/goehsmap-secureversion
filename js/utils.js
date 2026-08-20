// js/utils.js
const HelpManager = {
    data: null,
    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    },

    sanitizeHelpHtml(value) {
        const template = document.createElement('template');
        template.innerHTML = String(value ?? '').replace(/\r?\n/g, '<br>');
        const allowedTags = new Set(['br', 'p', 'strong', 'b', 'em', 'i', 'u', 'small', 'ul', 'ol', 'li', 'a', 'code']);
        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
            if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode('');

            const tagName = node.tagName.toLowerCase();
            const fragment = document.createDocumentFragment();
            if (!allowedTags.has(tagName)) {
                node.childNodes.forEach(child => fragment.appendChild(cleanNode(child)));
                return fragment;
            }

            const cleanEl = document.createElement(tagName);
            if (tagName === 'a') {
                const href = node.getAttribute('href') || '';
                if (/^(https?:|mailto:|tel:|#)/i.test(href)) {
                    cleanEl.setAttribute('href', href);
                    cleanEl.setAttribute('target', '_blank');
                    cleanEl.setAttribute('rel', 'noopener noreferrer');
                }
            }
            node.childNodes.forEach(child => cleanEl.appendChild(cleanNode(child)));
            return cleanEl;
        };

        const output = document.createElement('div');
        template.content.childNodes.forEach(node => output.appendChild(cleanNode(node)));
        return output.innerHTML;
    },

    formatCommitTime(iso) {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return this.data?.updateDate || '-';
        const parts = new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(date).reduce((acc, part) => {
            acc[part.type] = part.value;
            return acc;
        }, {});
        return `${parts.year}. ${parts.month}. ${parts.day}. (${parts.weekday}) ${parts.hour}:${parts.minute}`;
    },

    async loadLatestUpdateDate() {
        if (!this.data) return;
        try {
            const res = await fetch('/api/latest-commit', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data?.iso) return;
            this.data.updateDate = this.formatCommitTime(data.iso);
            const updateEl = document.getElementById('latestCommitDate');
            if (updateEl) updateEl.textContent = this.data.updateDate;
        } catch (err) {
            // 정적 파일로 열었거나 git 정보가 없는 배포에서는 시트의 날짜를 그대로 사용합니다.
        }
    },

    init(data) {
        if (!data || typeof data !== 'object') return;
        this.data = {
            headerText: data.headerText || '경기도화성오산교육지원청 학교 지도',
            updateDate: data.updateDate || '-',
            title: data.title || '사용 방법 안내',
            subtitle: data.subtitle || '도움말',
            content: data.content || '내용 없음',
            contact: data.contact || '-'
        };
        
        const titleEl = document.getElementById('header-title');
        if (titleEl) titleEl.innerText = this.data.headerText;
        
        const helpBtn = document.getElementById('helpBtn');
        if(helpBtn) helpBtn.addEventListener('click', () => this.showModal());
        this.loadLatestUpdateDate();
    },
    
    showModal() {
        if (!this.data) return;
        const modal = document.getElementById('helpModal');
        const contentBox = document.getElementById('helpContentInject');
        
        // 도움말 본문은 제한된 태그만 허용해서 HTML을 적용합니다.
        contentBox.innerHTML = `
            <div class="popup-category">${this.escapeHtml(this.data.subtitle)}</div>
            <div class="help-title">${this.escapeHtml(this.data.title)}</div>
            <div class="help-desc">${this.sanitizeHelpHtml(this.data.content)}</div>
            <hr class="popup-hr">
            <ul class="popup-info-list">
                <li><span class="label">최근 업데이트</span> <span class="value" id="latestCommitDate">${this.escapeHtml(this.data.updateDate)}</span></li>
                <li><span class="label">문의</span> <span class="value">${this.escapeHtml(this.data.contact)}</span></li>
            </ul>
        `;
        modal.style.display = 'flex';
    }
};
