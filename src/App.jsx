import { useState, useEffect, useRef } from "react";

const MFY_LIST = [
  "O'zbekiston MFY","Namozgoh MFY","Mustaqillik MFY","Taraqqiyot MFY","Teraktashi MFY","Poloson MFY",
  "Ahmadbek (Barkamolavlod)","Kalacha MFY","Do'lan MFY","Yangimahalla Y.Sh","Tumor MFY","Sohibobod MFY",
  "Buvoydo","Kumqayroq MFY","Abdubiy MFY","Sherkurg'on MFY","Yangi hayot","Birlashgan MFY","Kozikurg'on MFY",
  "Suzoq MFY","Beshmahalla MFY","Navro'z MFY","Yangi obod MFY","Nayman MFY (Turkiston)","Kurg'oncha MFY (Uzb)",
  "Bayroq MFY","Maslahatepa MFY","Bobochek MFY","Kumtepa MFY","Nazarmahram","Holdambek",
  "Kum MFY","Segaza MFY","Ortish MFY","Hujaobod MFY","Yonboshdurman MFY","Durman MFY","Oktunlik MFY",
  "Shaydo MFY","Tegirmonboshi MFY","Begbachcha MFY","Ipak yo'li MFY","Tulqin MFY","Yanginaynavo MFY",
  "Qorabo'yin MFY","Kumarik MFY","Kushkunok MFY","Yani zamon MFY","Markaz MFY","Yuzlar MFY",
  "Kipchakurg'on MFY","Nayman MFY (Y.Yo'l)","Shahrixon MFY","Kuruksoy MFY","Buston MFY (Chuja)",
  "Eshon MFY","Chuja MFY","Do'stlik MFY","Karnaychi MFY","Andajon MFY","Beshariq MFY","Yakkatut MFY",
  "Soroy MFY","Navbahor MFY","Kayrag'ochguzar MFY","Qorakurpa MFY","Mullahoy MFY","Kashqar MFY",
  "Bahor MFY","Andijonlik MFY","Yoshlar MFY","Yangi turmush MFY (Ur.)","Shokirboy MFY","Servis",
  "Hududgaz Andijon GTF Shahrixon tuman","Bo'lim boshlig'i"
].map((name, i) => ({ id: i + 1, name }));

const USERS = {
  admin: { password: "admin123", role: "boshliq", name: "Bo'lim boshlig'i" },
  hodim1: { password: "1234", role: "hodim", name: "Hodim Alisher" },
  hodim2: { password: "1234", role: "hodim", name: "Hodim Sardor" },
  hodim3: { password: "1234", role: "hodim", name: "Hodim Jasur" },
};

const fmt = (d) => new Date(d).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (d) => new Date(d).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
const todayStr = () => fmtDate(new Date());

// ─── Kamera ───
function Camera({ onCapture, label, icon }) {
  const vRef = useRef(null), cRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [on, setOn] = useState(false);
  const [img, setImg] = useState(null);

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: 640, height: 480 } });
      setStream(s); setOn(true);
      setTimeout(() => { if (vRef.current) vRef.current.srcObject = s; }, 100);
    } catch { alert("Kamera ruxsati berilmadi!"); }
  };
  const stop = () => { stream?.getTracks().forEach(t => t.stop()); setStream(null); setOn(false); };
  const snap = () => {
    const v = vRef.current, c = cRef.current; if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const url = c.toDataURL("image/jpeg", 0.7);
    setImg(url); onCapture(url); stop();
  };
  const retake = () => { setImg(null); onCapture(null); start(); };
  useEffect(() => () => { stream?.getTracks().forEach(t => t.stop()); }, [stream]);

  const btnBase = { border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer", color: "#fff" };

  if (img) return (
    <div style={{ position: "relative" }}>
      <img src={img} alt={label} style={{ width: "100%", borderRadius: 14, border: "2.5px solid #10b981" }} />
      <div style={{ position: "absolute", top: 10, right: 10, background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 700, boxShadow: "0 2px 8px rgba(16,185,129,0.4)" }}>✓ Tayyor</div>
      <button onClick={retake} style={{ ...btnBase, marginTop: 10, width: "100%", padding: 11, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.3)", fontSize: 14 }}>🔄 Qayta olish</button>
    </div>
  );
  return on ? (
    <div>
      <video ref={vRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 14, background: "#000" }} />
      <canvas ref={cRef} style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={snap} style={{ ...btnBase, flex: 1, padding: 13, background: "linear-gradient(135deg,#10b981,#059669)", boxShadow: "0 4px 16px rgba(16,185,129,0.3)" }}>📸 Rasmga olish</button>
        <button onClick={stop} style={{ ...btnBase, padding: "13px 18px", background: "#ef4444" }}>✕</button>
      </div>
    </div>
  ) : (
    <button onClick={start} style={{ ...btnBase, width: "100%", padding: 16, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 20px rgba(99,102,241,0.3)" }}>
      {icon} {label}
    </button>
  );
}

// ─── Login ───
function Login({ onLogin }) {
  const [u, setU] = useState(""), [p, setP] = useState(""), [err, setErr] = useState("");
  const go = () => { const x = USERS[u]; if (x && x.password === p) onLogin({ username: u, ...x }); else setErr("Login yoki parol noto'g'ri!"); };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0a0f1a 0%,#111827 40%,#0a0f1a 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400, background: "rgba(17,24,39,0.85)", backdropFilter: "blur(24px)", borderRadius: 28, padding: "36px 30px", border: "1px solid rgba(99,102,241,0.15)", boxShadow: "0 32px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 80, height: 80, background: "linear-gradient(135deg,#6366f1,#a855f7)", borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", fontSize: 36, boxShadow: "0 12px 40px rgba(99,102,241,0.4)", border: "2px solid rgba(255,255,255,0.1)" }}>🏘️</div>
          <h1 style={{ color: "#f1f5f9", fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.5px" }}>MFY Monitoring</h1>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 8 }}>Fuqarolarni ro'yxatga olish tizimi</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input value={u} onChange={e => { setU(e.target.value); setErr(""); }} placeholder="Login" style={{ padding: "15px 18px", background: "rgba(15,23,42,0.7)", border: "1.5px solid rgba(99,102,241,0.2)", borderRadius: 14, color: "#f1f5f9", fontSize: 15, outline: "none", transition: "border 0.2s" }} onFocus={e => e.target.style.borderColor = "rgba(99,102,241,0.5)"} onBlur={e => e.target.style.borderColor = "rgba(99,102,241,0.2)"} />
          <input type="password" value={p} onChange={e => { setP(e.target.value); setErr(""); }} placeholder="Parol" onKeyDown={e => e.key === "Enter" && go()} style={{ padding: "15px 18px", background: "rgba(15,23,42,0.7)", border: "1.5px solid rgba(99,102,241,0.2)", borderRadius: 14, color: "#f1f5f9", fontSize: 15, outline: "none" }} onFocus={e => e.target.style.borderColor = "rgba(99,102,241,0.5)"} onBlur={e => e.target.style.borderColor = "rgba(99,102,241,0.2)"} />
          {err && <div style={{ color: "#ef4444", fontSize: 13, textAlign: "center", padding: "10px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid rgba(239,68,68,0.15)" }}>{err}</div>}
          <button onClick={go} style={{ padding: 15, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 14, fontWeight: 700, fontSize: 16, cursor: "pointer", marginTop: 6, boxShadow: "0 6px 24px rgba(99,102,241,0.35)", transition: "transform 0.1s", position: "relative", overflow: "hidden" }} onMouseDown={e => e.target.style.transform = "scale(0.98)"} onMouseUp={e => e.target.style.transform = "scale(1)"}>Kirish →</button>
        </div>
        <div style={{ marginTop: 28, padding: "16px 18px", background: "rgba(15,23,42,0.5)", borderRadius: 14, border: "1px solid rgba(99,102,241,0.1)" }}>
          <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2 }}>Demo loginlar</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13, color: "#94a3b8" }}>
            <span style={{ fontFamily: "monospace" }}>admin / admin123</span><span style={{ color: "#a855f7", fontWeight: 600 }}>→ Boshliq</span>
            <span style={{ fontFamily: "monospace" }}>hodim1 / 1234</span><span style={{ color: "#6366f1", fontWeight: 600 }}>→ Hodim</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hodim ───
function Hodim({ user, records, setRecords, onLogout }) {
  const [step, setStep] = useState("mfy");
  const [mfy, setMfy] = useState(null);
  const [face, setFace] = useState(null);
  const [passport, setPassport] = useState(null);
  const [name, setName] = useState("");
  const [jshshir, setJshshir] = useState("");
  const [coords, setCoords] = useState(null);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => setCoords({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
      () => setCoords({ lat: "40.6367", lng: "71.5567" })
    );
  }, []);

  const myToday = records.filter(r => r.hodim === user.username && fmtDate(new Date(r.timestamp)) === todayStr()).length;
  const show = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const scanPassport = async (imgData) => {
    setPassport(imgData);
    if (!imgData) { setJshshir(""); return; }
    setScanning(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: imgData.split(",")[1] })
      });
      const data = await res.json();
      if (data.jshshir) { setJshshir(data.jshshir); show("✅ JShShIR avtomatik topildi!"); }
      else show("⚠️ JShShIR topilmadi, qo'lda kiriting", "error");
    } catch { show("⚠️ Skaner ishlamadi, qo'lda kiriting", "error"); }
    setScanning(false);
  };

  const submit = () => {
    if (!face || !passport || !name.trim() || jshshir.length !== 14) { show("Barcha ma'lumotlarni to'ldiring!", "error"); return; }
    setSending(true);
    setTimeout(() => {
      setRecords(prev => [...prev, {
        id: Date.now(), hodim: user.username, hodimName: user.name, mfy,
        fullName: name.trim(), jshshir, facePhoto: face, passportPhoto: passport,
        coords, timestamp: new Date().toISOString()
      }]);
      setSending(false);
      show("✅ Ma'lumot muvaffaqiyatli yuborildi!");
      setFace(null); setPassport(null); setName(""); setJshshir(""); setStep("mfy");
    }, 1200);
  };

  const filtered = MFY_LIST.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const inputStyle = { width: "100%", padding: "14px 16px", background: "rgba(15,23,42,0.6)", border: "1.5px solid rgba(99,102,241,0.2)", borderRadius: 13, color: "#f1f5f9", fontSize: 15, outline: "none", boxSizing: "border-box", transition: "border 0.2s" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0f1a,#111827)", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 999, background: toast.type === "error" ? "linear-gradient(135deg,#ef4444,#dc2626)" : "linear-gradient(135deg,#10b981,#059669)", color: "#fff", padding: "13px 28px", borderRadius: 16, fontWeight: 700, fontSize: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxWidth: "90vw", textAlign: "center" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "rgba(17,24,39,0.9)", backdropFilter: "blur(12px)", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(99,102,241,0.12)", position: "sticky", top: 0, zIndex: 50 }}>
        <div>
          <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>{user.name}</div>
          <div style={{ color: "#6366f1", fontSize: 12, fontWeight: 600 }}>Bugun: {myToday} ta yozuv</div>
        </div>
        <button onClick={onLogout} style={{ padding: "8px 18px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.25)", borderRadius: 11, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Chiqish</button>
      </div>

      {/* MFY tanlash */}
      {step === "mfy" && (
        <div style={{ padding: 20 }}>
          <h2 style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>MFY tanlang</h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 18px" }}>Qaysi mahallaga borayapsiz?</p>
          <div style={{ position: "relative", marginBottom: 14 }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Qidirish..." style={{ ...inputStyle, paddingLeft: 40 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "62vh", overflowY: "auto", paddingRight: 4 }}>
            {filtered.map(m => {
              const cnt = records.filter(r => r.mfy?.id === m.id && r.hodim === user.username).length;
              return (
                <button key={m.id} onClick={() => { setMfy(m); setStep("capture"); }} style={{
                  padding: "13px 16px", background: cnt > 0 ? "rgba(16,185,129,0.06)" : "rgba(17,24,39,0.5)",
                  border: cnt > 0 ? "1.5px solid rgba(16,185,129,0.2)" : "1.5px solid rgba(99,102,241,0.1)",
                  borderRadius: 13, color: "#f1f5f9", fontWeight: 600, fontSize: 14, cursor: "pointer",
                  textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                  transition: "all 0.15s"
                }}>
                  <span><span style={{ color: "#6366f1", marginRight: 10, fontSize: 12, fontWeight: 500, opacity: 0.7 }}>{m.id}</span>{m.name}</span>
                  {cnt > 0 && <span style={{ background: "rgba(16,185,129,0.15)", color: "#10b981", padding: "3px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>{cnt}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Ma'lumot kiritish */}
      {step === "capture" && (
        <div style={{ padding: 20 }}>
          <button onClick={() => setStep("mfy")} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 600, fontSize: 14, cursor: "pointer", padding: "0 0 14px", display: "flex", alignItems: "center", gap: 6 }}>← Orqaga</button>

          {/* Tanlangan MFY */}
          <div style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.12),rgba(168,85,247,0.08))", borderRadius: 18, padding: "16px 20px", marginBottom: 24, border: "1.5px solid rgba(99,102,241,0.15)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, background: "rgba(99,102,241,0.08)", borderRadius: "50%" }} />
            <div style={{ color: "#818cf8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5 }}>Tanlangan MFY</div>
            <div style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 800, marginTop: 4 }}>{mfy?.name}</div>
            {coords && <div style={{ color: "#64748b", fontSize: 11, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>📍 {coords.lat}, {coords.lng}</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {/* FIO */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>👤 F.I.O (to'liq ism)</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ism sharifni kiriting" style={inputStyle} />
            </div>

            {/* Yuz rasmi */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 10 }}>🤳 Fuqaro yuz rasmi (Face ID)</label>
              <Camera onCapture={setFace} label="Yuz rasmini olish" icon="🤳" />
            </div>

            {/* Pasport skaner */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>📄 Pasport rasmi → JShShIR avtomatik o'qiladi</label>
              <p style={{ color: "#475569", fontSize: 11, margin: "0 0 10px" }}>Pasportni rasmga oling, tizim JShShIR ni avtomatik topadi</p>
              <Camera onCapture={scanPassport} label="Pasportni skanerlash" icon="📄" />
              {scanning && (
                <div style={{ marginTop: 12, padding: "13px 18px", background: "rgba(99,102,241,0.08)", borderRadius: 12, border: "1.5px solid rgba(99,102,241,0.15)", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 20, height: 20, border: "3px solid #6366f1", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <span style={{ color: "#818cf8", fontSize: 13, fontWeight: 600 }}>JShShIR skanerlanmoqda...</span>
                </div>
              )}
            </div>

            {/* JShShIR */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>
                🔢 JShShIR (14 raqam)
                {jshshir.length === 14 && <span style={{ color: "#10b981", marginLeft: 10, fontSize: 12 }}>✓ to'g'ri</span>}
              </label>
              <input value={jshshir} onChange={e => { if (/^\d{0,14}$/.test(e.target.value)) setJshshir(e.target.value); }} placeholder="Avtomatik yoki qo'lda kiriting" maxLength={14} style={{
                ...inputStyle, fontSize: 18, letterSpacing: 3, fontFamily: "monospace", fontWeight: 700,
                background: jshshir.length === 14 ? "rgba(16,185,129,0.06)" : "rgba(15,23,42,0.6)",
                border: jshshir.length === 14 ? "2px solid rgba(16,185,129,0.35)" : "1.5px solid rgba(99,102,241,0.2)"
              }} />
              {jshshir && jshshir.length < 14 && <div style={{ color: "#f59e0b", fontSize: 11, marginTop: 6, fontWeight: 500 }}>{14 - jshshir.length} ta raqam qoldi</div>}
            </div>

            {/* Yuborish */}
            <button onClick={submit} disabled={sending || !face || !passport || !name.trim() || jshshir.length !== 14} style={{
              padding: 17, border: "none", borderRadius: 16, fontWeight: 800, fontSize: 16, cursor: sending ? "wait" : "pointer", marginTop: 4,
              background: (!face || !passport || !name.trim() || jshshir.length !== 14) ? "rgba(51,65,85,0.5)" : sending ? "#475569" : "linear-gradient(135deg,#10b981,#059669)",
              color: "#fff", opacity: (!face || !passport || !name.trim() || jshshir.length !== 14) ? 0.4 : 1,
              boxShadow: (face && passport && jshshir.length === 14 && !sending) ? "0 6px 24px rgba(16,185,129,0.3)" : "none",
              transition: "all 0.2s"
            }}>
              {sending ? "⏳ Yuborilmoqda..." : "✅ Ma'lumotni yuborish"}
            </button>
          </div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
    </div>
  );
}

// ─── Boshliq ───
function Boshliq({ user, records, onLogout }) {
  const [hodim, setHodim] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filterMfy, setFilterMfy] = useState(null);

  const hodimlar = Object.entries(USERS).filter(([, u]) => u.role === "hodim");
  const getStats = (un) => {
    const h = records.filter(r => r.hodim === un);
    const t = h.filter(r => fmtDate(new Date(r.timestamp)) === todayStr());
    return { total: h.length, today: t.length, mfys: [...new Set(h.map(r => r.mfy?.id))].length, last: h.length ? new Date(h[h.length - 1].timestamp) : null };
  };

  const list = (hodim ? records.filter(r => r.hodim === hodim) : records).filter(r => !filterMfy || r.mfy?.id === filterMfy);
  const todayAll = records.filter(r => fmtDate(new Date(r.timestamp)) === todayStr()).length;
  const mfyAll = [...new Set(records.map(r => r.mfy?.id))].length;

  // Batafsil ko'rish
  if (detail) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0f1a,#111827)", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background: "rgba(17,24,39,0.9)", backdropFilter: "blur(12px)", padding: "14px 20px", borderBottom: "1px solid rgba(99,102,241,0.12)", position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0 }}>← Orqaga</button>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ background: "rgba(17,24,39,0.7)", borderRadius: 20, padding: "22px 20px", border: "1.5px solid rgba(99,102,241,0.12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 20 }}>{detail.fullName}</div>
              <div style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>JShShIR: <span style={{ color: "#818cf8", fontFamily: "monospace", fontWeight: 700, letterSpacing: 2, fontSize: 15 }}>{detail.jshshir}</span></div>
            </div>
            <div style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.15),rgba(168,85,247,0.1))", color: "#a5b4fc", padding: "7px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700 }}>{detail.mfy?.name}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13, color: "#94a3b8" }}>
            <div style={{ padding: "8px 12px", background: "rgba(15,23,42,0.4)", borderRadius: 10 }}>📅 {fmtDate(new Date(detail.timestamp))}</div>
            <div style={{ padding: "8px 12px", background: "rgba(15,23,42,0.4)", borderRadius: 10 }}>🕐 {fmt(detail.timestamp)}</div>
            <div style={{ padding: "8px 12px", background: "rgba(15,23,42,0.4)", borderRadius: 10 }}>👤 {detail.hodimName}</div>
            <div style={{ padding: "8px 12px", background: "rgba(15,23,42,0.4)", borderRadius: 10 }}>📍 {detail.coords?.lat}, {detail.coords?.lng}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>🤳 Yuz rasmi</div>
            <img src={detail.facePhoto} alt="" style={{ width: "100%", borderRadius: 16, border: "2px solid rgba(99,102,241,0.2)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }} />
          </div>
          <div>
            <div style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>📄 Pasport</div>
            <img src={detail.passportPhoto} alt="" style={{ width: "100%", borderRadius: 16, border: "2px solid rgba(99,102,241,0.2)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }} />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0f1a,#111827)", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      {/* Header */}
      <div style={{ background: "rgba(17,24,39,0.9)", backdropFilter: "blur(12px)", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(99,102,241,0.12)", position: "sticky", top: 0, zIndex: 50 }}>
        <div>
          <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>👑 Boshliq paneli</div>
          <div style={{ color: "#a855f7", fontSize: 12, fontWeight: 600 }}>Boshqaruv tizimi</div>
        </div>
        <button onClick={onLogout} style={{ padding: "8px 18px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.25)", borderRadius: 11, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Chiqish</button>
      </div>

      {/* Statistika */}
      <div style={{ padding: "18px 20px 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[
          { l: "Jami", v: records.length, c: "#6366f1", g: "linear-gradient(135deg,rgba(99,102,241,0.12),rgba(99,102,241,0.05))", i: "📊" },
          { l: "Bugun", v: todayAll, c: "#10b981", g: "linear-gradient(135deg,rgba(16,185,129,0.12),rgba(16,185,129,0.05))", i: "📅" },
          { l: "MFY", v: mfyAll, c: "#f59e0b", g: "linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.05))", i: "🏘️" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.g, borderRadius: 16, padding: "16px 12px", border: `1.5px solid ${s.c}22`, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{s.i}</div>
            <div style={{ color: s.c, fontSize: 28, fontWeight: 800, marginTop: 2 }}>{s.v}</div>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Hodimlar */}
      <div style={{ padding: "22px 20px 10px" }}>
        <h3 style={{ color: "#f1f5f9", fontSize: 17, fontWeight: 800, margin: "0 0 14px" }}>👥 Hodimlar</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => setHodim(null)} style={{ padding: "11px 16px", background: !hodim ? "rgba(99,102,241,0.15)" : "rgba(17,24,39,0.5)", border: !hodim ? "1.5px solid rgba(99,102,241,0.3)" : "1.5px solid rgba(99,102,241,0.08)", borderRadius: 13, color: "#f1f5f9", fontWeight: 600, fontSize: 14, cursor: "pointer", textAlign: "left" }}>
            📋 Barchasi ({records.length})
          </button>
          {hodimlar.map(([un, ud]) => {
            const s = getStats(un);
            return (
              <button key={un} onClick={() => setHodim(un)} style={{ padding: "13px 16px", background: hodim === un ? "rgba(99,102,241,0.15)" : "rgba(17,24,39,0.5)", border: hodim === un ? "1.5px solid rgba(99,102,241,0.3)" : "1.5px solid rgba(99,102,241,0.08)", borderRadius: 13, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>{ud.name}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>
                    {s.mfys} MFY · Bugun {s.today} ta
                    {s.last && <span> · {fmt(s.last)}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", padding: "5px 12px", borderRadius: 9, fontSize: 14, fontWeight: 800 }}>{s.total}</span>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.today > 0 ? "#10b981" : "#374151", boxShadow: s.today > 0 ? "0 0 8px rgba(16,185,129,0.5)" : "none" }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* MFY filter */}
      {records.length > 0 && (
        <div style={{ padding: "4px 20px 8px" }}>
          <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 6 }}>
            <button onClick={() => setFilterMfy(null)} style={{ padding: "7px 14px", background: !filterMfy ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(17,24,39,0.5)", color: "#fff", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Barchasi</button>
            {[...new Set(records.map(r => r.mfy?.id))].sort((a, b) => a - b).map(id => (
              <button key={id} onClick={() => setFilterMfy(id)} style={{ padding: "7px 14px", background: filterMfy === id ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(17,24,39,0.5)", color: filterMfy === id ? "#fff" : "#94a3b8", border: "1.5px solid rgba(99,102,241,0.1)", borderRadius: 10, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                {MFY_LIST.find(m => m.id === id)?.name || id} ({records.filter(r => r.mfy?.id === id).length})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Yozuvlar */}
      <div style={{ padding: "8px 20px 24px" }}>
        <h3 style={{ color: "#f1f5f9", fontSize: 17, fontWeight: 800, margin: "0 0 14px" }}>
          📋 Yozuvlar {hodim && <span style={{ color: "#818cf8", fontWeight: 600, fontSize: 14 }}>({USERS[hodim]?.name})</span>}
        </h3>
        {list.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#374151" }}>
            <div style={{ fontSize: 48, marginBottom: 14, opacity: 0.6 }}>📭</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Hali yozuvlar yo'q</div>
            <div style={{ fontSize: 12, marginTop: 6, color: "#475569" }}>Hodimlar ma'lumot yuborganda bu yerda ko'rinadi</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...list].reverse().map(r => (
              <button key={r.id} onClick={() => setDetail(r)} style={{ padding: "14px 16px", background: "rgba(17,24,39,0.5)", border: "1.5px solid rgba(99,102,241,0.08)", borderRadius: 16, cursor: "pointer", textAlign: "left", display: "flex", gap: 14, alignItems: "center", transition: "all 0.15s" }}>
                <img src={r.facePhoto} alt="" style={{ width: 50, height: 50, borderRadius: 14, objectFit: "cover", border: "2px solid rgba(99,102,241,0.15)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.fullName}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>{r.mfy?.name} · {r.hodimName} · {fmt(r.timestamp)}</div>
                </div>
                <span style={{ color: "#6366f1", fontSize: 20, fontWeight: 300 }}>›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App ───
export default function App() {
  const [user, setUser] = useState(null);
  const [records, setRecords] = useState([]);
  if (!user) return <Login onLogin={setUser} />;
  if (user.role === "hodim") return <Hodim user={user} records={records} setRecords={setRecords} onLogout={() => setUser(null)} />;
  return <Boshliq user={user} records={records} onLogout={() => setUser(null)} />;
}
