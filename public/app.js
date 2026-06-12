const API = { pairing: '/api/pairing', qr: '/api/qr', settings: '/api/settings' }; // أضفنا مسار الـ API الخاص بالإعدادات

let currentLang = 'ar';

function initPage(lang) {
    currentLang = lang;
    document.getElementById('langOverlay').style.display = 'none';
    document.getElementById('mainBody').style.display = 'block';
}

function switchTab(tab) {
    document.getElementById('panelPairing').classList.toggle('hidden', tab === 'qr');
    document.getElementById('panelQr').classList.toggle('hidden', tab === 'pairing');
    if (tab === 'qr') loadQr();
}

async function loadQr() {
    const img = document.getElementById('qrImage');
    img.src = `${API.qr}?t=${Date.now()}`;
    img.onload = () => {
        img.style.display = 'block';
        document.getElementById('qrPlaceholder').style.display = 'none';
    };
}

// دالة جديدة لجلب بيانات الإعدادات
async function loadSettings(phone) {
    try {
        const res = await fetch(`${API.settings}?phone=${phone}`);
        const data = await res.json();
        return data;
    } catch (e) {
        console.error("خطأ في جلب الإعدادات", e);
    }
}

async function handleSubmit() {
    let phone = document.getElementById('phoneNum').value.trim();
    if (!phone) return Swal.fire('خطأ', 'أدخل الرقم أولاً', 'error');

    Swal.fire({ title: 'جاري المعالجة...', didOpen: () => Swal.showLoading() });

    try {
        const res = await fetch(API.pairing, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ num: phone })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ title: 'تم توليد الكود!', html: `<b style="font-size:2rem; color:#d4a055;">${data.code}</b>`, icon: 'success' });
        }
    } catch (e) {
        Swal.fire('فشل', 'حدث خطأ في السيرفر', 'error');
    }
}
