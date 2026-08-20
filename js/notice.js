// js/notice.js
const NoticeManager = {
    init() {
        const popup = document.getElementById('shared-school-popup');
        if (!popup) return;
      
        const btnClose = document.getElementById('btn-close-popup');
        const chk7Days = document.getElementById('chk-hide-7days');
        const chkForever = document.getElementById('chk-hide-forever');
      
        const hideForever = localStorage.getItem('hideSharedPopupForever');
        const hideExpiry = localStorage.getItem('hideSharedPopupExpiry');
        const now = Date.now();
      
        // '계속 보지 않기' 또는 '7일간 보지 않기' 기한 확인
        if (hideForever === 'true' || (hideExpiry && now < parseInt(hideExpiry, 10))) {
            return; 
        }
      
        setTimeout(() => popup.classList.add('active'), 300);
      
        chk7Days.addEventListener('change', () => { if (chk7Days.checked) chkForever.checked = false; });
        chkForever.addEventListener('change', () => { if (chkForever.checked) chk7Days.checked = false; });
      
        btnClose.addEventListener('click', () => {
            if (chkForever.checked) {
                localStorage.setItem('hideSharedPopupForever', 'true');
            } else if (chk7Days.checked) {
                localStorage.setItem('hideSharedPopupExpiry', (now + 7 * 24 * 60 * 60 * 1000).toString());
            }
        
            popup.classList.remove('active');
            setTimeout(() => { popup.style.display = 'none'; }, 300);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => NoticeManager.init());