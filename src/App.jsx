import { useState, useEffect, useRef } from "react";
import Tesseract from "tesseract.js";

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
  admin:  { password: "admin123", role: "boshliq", name: "Bo'lim boshlig'i" },
  hodim1: { password: "1234",     role: "hodim",   name: "Hodim Alisher" },
  hodim2: { password: "1234",     role: "hodim",   name: "Hodim Sardor" },
  hodim3: { password: "1234",     role: "hodim",   name: "Hodim Jasur" },
};

const fmt     = d => new Date(d).toLocaleTimeString("uz-UZ",  { hour: "2-digit", minute: "2-digit" });
const fmtDate = d => new Date(d).toLocaleDateString("uz-UZ",  { day: "2-digit", month: "2-digit", year: "numeric" });
const todayStr = () => fmtDate(new Date());

// ─── PassportScanner ───────────────────────────────────────────────────────────
function PassportScanner({ onFound }) {
  const vRef      = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const busyRef   = useRef(false);
  const foundRef  = useRef(false);
  const [status, setStatus] = useState("Kamera yoqilmoqda...");
  const [active, setActive] = useState(false);
  const [pulse, setPulse]   = useState(false);

  const cropPart = (canvas, yStart, yEnd) => {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = Math.floor(canvas.height * (yEnd - yStart));
    c.getContext("2d").drawImage(canvas, 0, -canvas.height * yStart);
    return c.toDataURL("image/jpeg", 0.88);
  };

  const tryFind = text => {
    const kw = text.match(/(?:personal\s*number|shaxsiy\s*raqam)[^\d]*(\d{14})/i);
    if (kw) return kw[1];
    // MRZ qatorlarini olib tashlash (faqat katta harflar va < belgisi)
    const noMrz = text.split("\n").filter(l => !(/^[A-Z0-9<]{10,}$/).test(l.trim())).join(" ");
    const m = [...noMrz.replace(/\s/g, "").matchAll(/[1-6]\d{13}/g)];
    return m.length ? m[0][0] : null;
  };

  // MRZ qatoridan ism o'qish: "ADXAMJONOV<<DOSTONBEK<<<" → "Dostonbek Adxamjonov"
  const parseName = text => {
    const lines = text.split("\n").map(l => l.trim());
    for (const line of lines) {
      const m = line.match(/([A-Z]{2,})<<([A-Z]+)/);
      if (m) {
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        const surname  = cap(m[1]);
        const firstname = cap(m[2]);
        return `${firstname} ${surname}`;
      }
    }
    return null;
  };

  const scanFrame = async () => {
    if (busyRef.current || foundRef.current) return;
    const v = vRef.current, c = canvasRef.current;
    if (!v || !c || v.readyState < 2) return;
    busyRef.current = true;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const photoUrl = c.toDataURL("image/jpeg", 0.75);
    try {
      // JSHSHIR uchun yuqori qism, ism uchun pastki qism — parallel
      const [topResult, botResult] = await Promise.all([
        Tesseract.recognize(cropPart(c, 0, 0.65), "eng"),
        Tesseract.recognize(cropPart(c, 0.60, 1.0), "eng"),
      ]);
      const jshshir = tryFind(topResult.data.text);
      if (jshshir) {
        const fullName = parseName(botResult.data.text);
        foundRef.current = true;
        setPulse(true);
        streamRef.current?.getTracks().forEach(t => t.stop());
        setTimeout(() => onFound(jshshir, fullName, photoUrl), 400);
        return;
      }
      setStatus("Pasportni yaqinroq va to'g'ri tutib turing...");
    } catch {}
    busyRef.current = false;
  };

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then(s => {
      streamRef.current = s;
      setTimeout(() => { if (vRef.current) vRef.current.srcObject = s; }, 100);
      setActive(true);
      setStatus("Pasportni kameraga tutib turing — o'zi topadi");
    }).catch(() => setStatus("Kamera ruxsati berilmadi!"));
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(scanFrame, 2500);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div>
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "#000" }}>
        <video ref={vRef} autoPlay playsInline muted style={{ width: "100%", display: "block", maxHeight: 260, objectFit: "cover" }} />

        {/* scan line animation */}
        {active && !pulse && (
          <div style={{ position: "absolute", left: 0, right: 0, height: 3,
            background: "linear-gradient(90deg, transparent, #6366f1, #a855f7, #6366f1, transparent)",
            animation: "scanLine 2s ease-in-out infinite", boxShadow: "0 0 12px rgba(99,102,241,0.8)" }} />
        )}

        {/* success pulse */}
        {pulse && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(16,185,129,0.25)",
            animation: "pulseFade 0.4s ease-out", display: "flex", alignItems: "center",
            justifyContent: "center" }}>
            <div style={{ fontSize: 64 }}>✅</div>
          </div>
        )}

        {/* corner brackets */}
        {[[{top:10,left:10},{borderTop:"3px solid #6366f1",borderLeft:"3px solid #6366f1"}],
          [{top:10,right:10},{borderTop:"3px solid #6366f1",borderRight:"3px solid #6366f1"}],
          [{bottom:10,left:10},{borderBottom:"3px solid #6366f1",borderLeft:"3px solid #6366f1"}],
          [{bottom:10,right:10},{borderBottom:"3px solid #6366f1",borderRight:"3px solid #6366f1"}]
        ].map(([pos, border], i) => (
          <div key={i} style={{ position: "absolute", width: 26, height: 26, borderRadius: 3, ...pos, ...border, pointerEvents: "none" }} />
        ))}
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div style={{ marginTop: 8, padding: "10px 14px", background: "rgba(99,102,241,0.08)",
        border: "1.5px solid rgba(99,102,241,0.18)", borderRadius: 12,
        display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 14, height: 14, border: "2.5px solid #6366f1",
          borderTopColor: "transparent", borderRadius: "50%",
          animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
        <span style={{ color: "#818cf8", fontSize: 12, fontWeight: 600 }}>{status}</span>
      </div>
      <style>{`
        @keyframes scanLine { 0%{top:8%} 50%{top:82%} 100%{top:8%} }
        @keyframes spin     { to{transform:rotate(360deg)} }
        @keyframes pulseFade{ 0%{opacity:1} 100%{opacity:0} }
        @keyframes slideUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
        @keyframes popIn    { 0%{transform:scale(0.5);opacity:0} 70%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
      `}</style>
    </div>
  );
}

// ─── Camera ───────────────────────────────────────────────────────────────────
function Camera({ onCapture, label, icon }) {
  const vRef = useRef(null), cRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [on, setOn]         = useState(false);
  const [img, setImg]       = useState(null);
  const [count, setCount]   = useState(null);

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 }
      });
      setStream(s); setOn(true);
      setTimeout(() => { if (vRef.current) vRef.current.srcObject = s; }, 100);
    } catch { alert("Kamera ruxsati berilmadi!"); }
  };
  const stop  = () => { stream?.getTracks().forEach(t => t.stop()); setStream(null); setOn(false); };
  const snap  = () => {
    const v = vRef.current, c = cRef.current; if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const url = c.toDataURL("image/jpeg", 0.8);
    setImg(url); onCapture(url); stop();
  };
  const startCountdown = () => {
    setCount(3);
    const id = setInterval(() => {
      setCount(prev => {
        if (prev <= 1) { clearInterval(id); snap(); return null; }
        return prev - 1;
      });
    }, 1000);
  };
  const retake = () => { setImg(null); onCapture(null); start(); };
  useEffect(() => () => stream?.getTracks().forEach(t => t.stop()), [stream]);

  if (img) return (
    <div style={{ position: "relative" }}>
      <img src={img} alt={label} style={{ width: "100%", borderRadius: 14, border: "2.5px solid #10b981", objectFit: "cover" }} />
      <div style={{ position: "absolute", top: 10, right: 10, background: "linear-gradient(135deg,#10b981,#059669)",
        color: "#fff", borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 700 }}>✓ Tayyor</div>
      <button onClick={retake} style={{ marginTop: 10, width: "100%", padding: 11, background: "rgba(239,68,68,0.08)",
        color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.3)", borderRadius: 12,
        fontWeight: 600, fontSize: 14, cursor: "pointer" }}>🔄 Qayta olish</button>
    </div>
  );

  if (on) return (
    <div>
      <div style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}>
        <video ref={vRef} autoPlay playsInline muted style={{ width: "100%", display: "block", maxHeight: 240, objectFit: "cover" }} />
        {count && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 80, fontWeight: 900, color: "#fff",
              textShadow: "0 0 30px rgba(99,102,241,0.8)", animation: "popIn 0.4s ease" }}>{count}</div>
          </div>
        )}
      </div>
      <canvas ref={cRef} style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={startCountdown} disabled={!!count} style={{ flex: 1, padding: 13, border: "none",
          borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer", color: "#fff",
          background: "linear-gradient(135deg,#10b981,#059669)",
          boxShadow: "0 4px 16px rgba(16,185,129,0.3)" }}>📸 3s-Countdown</button>
        <button onClick={snap} disabled={!!count} style={{ padding: "13px 18px", border: "none",
          borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer",
          color: "#fff", background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>📸</button>
        <button onClick={stop} style={{ padding: "13px 16px", border: "none", borderRadius: 12,
          fontWeight: 700, fontSize: 15, cursor: "pointer", color: "#fff", background: "#ef4444" }}>✕</button>
      </div>
    </div>
  );

  return (
    <button onClick={start} style={{ width: "100%", padding: 16, border: "none", borderRadius: 13,
      fontWeight: 700, fontSize: 15, cursor: "pointer", color: "#fff",
      background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      boxShadow: "0 4px 20px rgba(99,102,241,0.3)" }}>
      {icon} {label}
    </button>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [u, setU] = useState(""), [p, setP] = useState(""), [err, setErr] = useState("");
  const go = () => {
    const x = USERS[u];
    if (x && x.password === p) onLogin({ username: u, ...x });
    else setErr("Login yoki parol noto'g'ri!");
  };
  const inp = { padding: "15px 18px", background: "rgba(15,23,42,0.7)",
    border: "1.5px solid rgba(99,102,241,0.2)", borderRadius: 14, color: "#f1f5f9",
    fontSize: 15, outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0a0f1a,#111827)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400, background: "rgba(17,24,39,0.9)",
        backdropFilter: "blur(24px)", borderRadius: 28, padding: "40px 30px",
        border: "1px solid rgba(99,102,241,0.2)", boxShadow: "0 32px 64px rgba(0,0,0,0.7)",
        animation: "slideUp 0.4s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 88, height: 88, background: "linear-gradient(135deg,#6366f1,#a855f7)",
            borderRadius: 26, display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 18px", fontSize: 40, boxShadow: "0 12px 40px rgba(99,102,241,0.5)" }}>🏘️</div>
          <h1 style={{ color: "#f1f5f9", fontSize: 26, fontWeight: 900, margin: 0 }}>MFY Monitoring</h1>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 8 }}>Fuqarolarni ro'yxatga olish tizimi</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input value={u} onChange={e => { setU(e.target.value); setErr(""); }}
            placeholder="Login" style={inp}
            onFocus={e => e.target.style.borderColor="#6366f1"} onBlur={e => e.target.style.borderColor="rgba(99,102,241,0.2)"} />
          <input type="password" value={p} onChange={e => { setP(e.target.value); setErr(""); }}
            placeholder="Parol" onKeyDown={e => e.key === "Enter" && go()} style={inp}
            onFocus={e => e.target.style.borderColor="#6366f1"} onBlur={e => e.target.style.borderColor="rgba(99,102,241,0.2)"} />
          {err && <div style={{ color: "#ef4444", fontSize: 13, textAlign: "center",
            padding: "10px 14px", background: "rgba(239,68,68,0.1)", borderRadius: 10 }}>{err}</div>}
          <button onClick={go} style={{ padding: 16, background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            color: "#fff", border: "none", borderRadius: 14, fontWeight: 800,
            fontSize: 16, cursor: "pointer", boxShadow: "0 6px 24px rgba(99,102,241,0.35)" }}>
            Kirish →
          </button>
        </div>
        <div style={{ marginTop: 24, padding: "14px 16px", background: "rgba(15,23,42,0.5)",
          borderRadius: 14, border: "1px solid rgba(99,102,241,0.1)" }}>
          <p style={{ color: "#64748b", fontSize: 11, margin: "0 0 8px", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: 1 }}>Demo loginlar</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, fontSize: 12, color: "#94a3b8" }}>
            <span style={{ fontFamily: "monospace" }}>admin / admin123</span>
            <span style={{ color: "#a855f7", fontWeight: 600 }}>→ Boshliq</span>
            <span style={{ fontFamily: "monospace" }}>hodim1 / 1234</span>
            <span style={{ color: "#6366f1", fontWeight: 600 }}>→ Hodim</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

// ─── Hodim ───────────────────────────────────────────────────────────────────
function Hodim({ user, records, setRecords, onLogout }) {
  const [step, setStep]       = useState("mfy");
  const [mfy, setMfy]         = useState(null);
  const [face, setFace]       = useState(null);
  const [passport, setPassport] = useState(null);
  const [name, setName]       = useState("");
  const [jshshir, setJshshir] = useState("");
  const [coords, setCoords]   = useState(null);
  const [sending, setSending] = useState(false);
  const [search, setSearch]   = useState("");
  const [toast, setToast]     = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => setCoords({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
      () => setCoords({ lat: "40.6367", lng: "71.5567" })
    );
  }, []);

  const myToday = records.filter(r =>
    r.hodim === user.username && fmtDate(new Date(r.timestamp)) === todayStr()
  ).length;

  const show = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const onPassportFound = (j, fullName, photo) => {
    setJshshir(j);
    setPassport(photo);
    if (fullName && !name.trim()) {
      setName(fullName);
      show("✅ JShShIR va ism avtomatik topildi!");
    } else {
      show("✅ JShShIR avtomatik topildi!");
    }
  };

  const submit = () => {
    if (!face || !passport || !name.trim() || jshshir.length !== 14) {
      show("Barcha ma'lumotlarni to'ldiring!", "error"); return;
    }
    setSending(true);
    setTimeout(() => {
      const rec = {
        id: Date.now(), hodim: user.username, hodimName: user.name, mfy,
        fullName: name.trim(), jshshir, facePhoto: face, passportPhoto: passport,
        coords, timestamp: new Date().toISOString()
      };
      setRecords(prev => [...prev, rec]);
      setSending(false);
      setSuccess(rec);
      setFace(null); setPassport(null); setName(""); setJshshir(""); setStep("mfy");
    }, 1000);
  };

  const filtered = MFY_LIST.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const inp = { width: "100%", padding: "14px 16px", background: "rgba(15,23,42,0.6)",
    border: "1.5px solid rgba(99,102,241,0.2)", borderRadius: 13, color: "#f1f5f9",
    fontSize: 15, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0f1a,#111827)",
      fontFamily: "'Segoe UI',system-ui,sans-serif" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 999, background: toast.type === "error"
            ? "linear-gradient(135deg,#ef4444,#dc2626)"
            : "linear-gradient(135deg,#10b981,#059669)",
          color: "#fff", padding: "13px 28px", borderRadius: 16, fontWeight: 700,
          fontSize: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          maxWidth: "90vw", textAlign: "center", animation: "slideUp 0.3s ease" }}>
          {toast.msg}
        </div>
      )}

      {/* Success modal */}
      {success && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20, backdropFilter: "blur(8px)" }}>
          <div style={{ background: "rgba(17,24,39,0.98)", borderRadius: 28, padding: "36px 28px",
            maxWidth: 380, width: "100%", textAlign: "center",
            border: "1.5px solid rgba(16,185,129,0.3)", animation: "slideUp 0.4s ease",
            boxShadow: "0 0 60px rgba(16,185,129,0.15)" }}>
            <div style={{ fontSize: 72, animation: "popIn 0.5s ease", marginBottom: 16 }}>🎉</div>
            <h2 style={{ color: "#10b981", fontSize: 22, fontWeight: 900, margin: "0 0 8px" }}>
              Muvaffaqiyatli!
            </h2>
            <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 20px" }}>
              Ma'lumot tizimga saqlandi
            </p>
            <div style={{ background: "rgba(16,185,129,0.08)", borderRadius: 16, padding: "16px 20px",
              textAlign: "left", marginBottom: 24, border: "1px solid rgba(16,185,129,0.15)" }}>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 18 }}>{success.fullName}</div>
              <div style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 14,
                letterSpacing: 2, marginTop: 6 }}>{success.jshshir}</div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>{success.mfy?.name}</div>
            </div>
            <button onClick={() => setSuccess(null)} style={{ width: "100%", padding: 15,
              background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff",
              border: "none", borderRadius: 14, fontWeight: 800, fontSize: 16, cursor: "pointer",
              boxShadow: "0 6px 24px rgba(16,185,129,0.35)" }}>
              ➕ Keyingi fuqaro
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: "rgba(17,24,39,0.95)", backdropFilter: "blur(12px)",
        padding: "14px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", borderBottom: "1px solid rgba(99,102,241,0.12)",
        position: "sticky", top: 0, zIndex: 50 }}>
        <div>
          <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>{user.name}</div>
          <div style={{ color: "#6366f1", fontSize: 12, fontWeight: 600 }}>
            Bugun: {myToday} ta yozuv • Jami: {records.filter(r => r.hodim === user.username).length}
          </div>
        </div>
        <button onClick={onLogout} style={{ padding: "8px 18px", background: "rgba(239,68,68,0.1)",
          color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.25)",
          borderRadius: 11, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Chiqish</button>
      </div>

      {/* MFY tanlash */}
      {step === "mfy" && (
        <div style={{ padding: 20 }}>
          <h2 style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>MFY tanlang</h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>Qaysi mahallaga borasiz?</p>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Qidirish..." style={{ ...inp, paddingLeft: 42 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "66vh", overflowY: "auto" }}>
            {filtered.map(m => {
              const cnt = records.filter(r => r.mfy?.id === m.id && r.hodim === user.username).length;
              return (
                <button key={m.id} onClick={() => { setMfy(m); setStep("capture"); }} style={{
                  padding: "13px 16px",
                  background: cnt > 0 ? "rgba(16,185,129,0.07)" : "rgba(17,24,39,0.5)",
                  border: cnt > 0 ? "1.5px solid rgba(16,185,129,0.2)" : "1.5px solid rgba(99,102,241,0.1)",
                  borderRadius: 13, color: "#f1f5f9", fontWeight: 600, fontSize: 14,
                  cursor: "pointer", textAlign: "left", display: "flex",
                  justifyContent: "space-between", alignItems: "center" }}>
                  <span>
                    <span style={{ color: "#475569", marginRight: 10, fontSize: 11 }}>{m.id}</span>
                    {m.name}
                  </span>
                  {cnt > 0 && (
                    <span style={{ background: "rgba(16,185,129,0.15)", color: "#10b981",
                      padding: "3px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>{cnt}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Ma'lumot kiritish */}
      {step === "capture" && (
        <div style={{ padding: 20 }}>
          <button onClick={() => setStep("mfy")} style={{ background: "none", border: "none",
            color: "#6366f1", fontWeight: 600, fontSize: 14, cursor: "pointer",
            padding: "0 0 14px", display: "flex", alignItems: "center", gap: 6 }}>← Orqaga</button>

          {/* MFY badge */}
          <div style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.15),rgba(168,85,247,0.08))",
            borderRadius: 18, padding: "16px 20px", marginBottom: 24,
            border: "1.5px solid rgba(99,102,241,0.2)" }}>
            <div style={{ color: "#818cf8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5 }}>Tanlangan MFY</div>
            <div style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 800, marginTop: 4 }}>{mfy?.name}</div>
            {coords && <div style={{ color: "#64748b", fontSize: 11, marginTop: 6 }}>📍 {coords.lat}, {coords.lng}</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {/* FIO */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>
                👤 F.I.O (to'liq ism)
              </label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Ism sharifni kiriting" style={inp} />
            </div>

            {/* Yuz rasmi */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 10 }}>
                🤳 Fuqaro yuz rasmi
                {face && <span style={{ color: "#10b981", marginLeft: 8, fontSize: 12 }}>✓</span>}
              </label>
              <Camera onCapture={setFace} label="Yuz rasmini olish" icon="🤳" />
            </div>

            {/* Pasport */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                📄 Pasport skaneri — avtomatik
                {passport && <span style={{ color: "#10b981", marginLeft: 8, fontSize: 12 }}>✓</span>}
              </label>
              <p style={{ color: "#475569", fontSize: 11, margin: "0 0 10px" }}>
                Pasportni kameraga tutib turing — o'zi topadi
              </p>
              {passport ? (
                <div style={{ position: "relative" }}>
                  <img src={passport} alt="pasport" style={{ width: "100%", borderRadius: 14, border: "2.5px solid #10b981" }} />
                  <div style={{ position: "absolute", top: 10, right: 10, background: "linear-gradient(135deg,#10b981,#059669)",
                    color: "#fff", borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 700 }}>✓ Tayyor</div>
                  <button onClick={() => { setPassport(null); setJshshir(""); }} style={{
                    marginTop: 10, width: "100%", padding: 11, background: "rgba(239,68,68,0.08)",
                    color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.3)", borderRadius: 12,
                    fontWeight: 600, fontSize: 14, cursor: "pointer" }}>🔄 Qayta skanerlash</button>
                </div>
              ) : (
                <PassportScanner onFound={onPassportFound} />
              )}
            </div>

            {/* JShShIR */}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>
                🔢 JShShIR (14 raqam)
                {jshshir.length === 14 && <span style={{ color: "#10b981", marginLeft: 8, fontSize: 12 }}>✓ to'g'ri</span>}
              </label>
              <input value={jshshir}
                onChange={e => { if (/^\d{0,14}$/.test(e.target.value)) setJshshir(e.target.value); }}
                placeholder="Avtomatik yoki qo'lda kiriting" maxLength={14}
                style={{ ...inp, fontSize: 18, letterSpacing: 3, fontFamily: "monospace", fontWeight: 700,
                  background: jshshir.length === 14 ? "rgba(16,185,129,0.07)" : "rgba(15,23,42,0.6)",
                  border: jshshir.length === 14 ? "2px solid rgba(16,185,129,0.4)" : "1.5px solid rgba(99,102,241,0.2)" }} />
              {jshshir && jshshir.length < 14 && (
                <div style={{ color: "#f59e0b", fontSize: 11, marginTop: 6 }}>
                  {14 - jshshir.length} ta raqam qoldi
                </div>
              )}
            </div>

            {/* Progress */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
              {[
                { ok: !!name.trim(), label: "FIO" },
                { ok: !!face,        label: "Yuz" },
                { ok: !!passport,    label: "Pasport" },
                { ok: jshshir.length === 14, label: "JSHSHIR" },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ height: 4, borderRadius: 4, marginBottom: 5,
                    background: s.ok ? "#10b981" : "rgba(99,102,241,0.15)",
                    transition: "background 0.3s" }} />
                  <div style={{ fontSize: 10, color: s.ok ? "#10b981" : "#475569", fontWeight: 600 }}>
                    {s.ok ? "✓" : "○"} {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Submit */}
            <button onClick={submit}
              disabled={sending || !face || !passport || !name.trim() || jshshir.length !== 14}
              style={{ padding: 17, border: "none", borderRadius: 16, fontWeight: 800,
                fontSize: 16, cursor: "pointer", color: "#fff", transition: "all 0.2s",
                background: (!face || !passport || !name.trim() || jshshir.length !== 14)
                  ? "rgba(51,65,85,0.5)"
                  : sending ? "#475569" : "linear-gradient(135deg,#10b981,#059669)",
                opacity: (!face || !passport || !name.trim() || jshshir.length !== 14) ? 0.4 : 1,
                boxShadow: (face && passport && jshshir.length === 14 && !sending)
                  ? "0 6px 24px rgba(16,185,129,0.35)" : "none" }}>
              {sending ? "⏳ Saqlanmoqda..." : "✅ Ma'lumotni yuborish"}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
        @keyframes popIn{0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
        @keyframes scanLine{0%{top:8%}50%{top:82%}100%{top:8%}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulseFade{0%{opacity:1}100%{opacity:0}}
      `}</style>
    </div>
  );
}

// ─── Boshliq ──────────────────────────────────────────────────────────────────
function Boshliq({ user, records, onLogout }) {
  const [hodimFilter, setHodimFilter] = useState(null);
  const [mfyFilter,   setMfyFilter]   = useState(null);
  const [dateFilter,  setDateFilter]  = useState("all");
  const [search,      setSearch]      = useState("");
  const [detail,      setDetail]      = useState(null);
  const [tab,         setTab]         = useState("records");

  const hodimlar = Object.entries(USERS).filter(([, u]) => u.role === "hodim");

  const filtered = records.filter(r => {
    if (hodimFilter && r.hodim !== hodimFilter) return false;
    if (mfyFilter   && r.mfy?.id !== mfyFilter) return false;
    if (dateFilter === "today" && fmtDate(new Date(r.timestamp)) !== todayStr()) return false;
    if (dateFilter === "week") {
      const d = new Date(); d.setDate(d.getDate() - 7);
      if (new Date(r.timestamp) < d) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (!r.fullName?.toLowerCase().includes(q) && !r.jshshir?.includes(q) && !r.mfy?.name?.toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const exportCSV = () => {
    const headers = ["#","Ism","JSHSHIR","MFY","Hodim","Sana","Vaqt","Joylashuv"];
    const rows = records.map((r, i) => [
      i + 1, r.fullName, r.jshshir, r.mfy?.name, r.hodimName,
      fmtDate(r.timestamp), fmt(r.timestamp),
      `${r.coords?.lat},${r.coords?.lng}`
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `mfy_${todayStr().replace(/\./g, "-")}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const todayAll = records.filter(r => fmtDate(new Date(r.timestamp)) === todayStr()).length;
  const maxToday = Math.max(1, ...hodimlar.map(([un]) =>
    records.filter(r => r.hodim === un && fmtDate(new Date(r.timestamp)) === todayStr()).length
  ));

  if (detail) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0f1a,#111827)",
      fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background: "rgba(17,24,39,0.95)", backdropFilter: "blur(12px)",
        padding: "14px 20px", borderBottom: "1px solid rgba(99,102,241,0.12)",
        position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => setDetail(null)} style={{ background: "none", border: "none",
          color: "#6366f1", fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0 }}>← Orqaga</button>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ background: "rgba(17,24,39,0.8)", borderRadius: 20, padding: "22px 20px",
          border: "1.5px solid rgba(99,102,241,0.15)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 22 }}>{detail.fullName}</div>
              <div style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>
                JShShIR: <span style={{ color: "#818cf8", fontFamily: "monospace",
                  fontWeight: 700, letterSpacing: 2, fontSize: 15 }}>{detail.jshshir}</span>
              </div>
            </div>
            <div style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc",
              padding: "7px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700 }}>
              {detail.mfy?.name}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
            {[
              ["📅", fmtDate(new Date(detail.timestamp))],
              ["🕐", fmt(detail.timestamp)],
              ["👤", detail.hodimName],
              ["📍", `${detail.coords?.lat}, ${detail.coords?.lng}`],
            ].map(([icon, val], i) => (
              <div key={i} style={{ padding: "10px 12px", background: "rgba(15,23,42,0.5)",
                borderRadius: 10, color: "#94a3b8" }}>
                {icon} {val}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[["🤳 Yuz rasmi", detail.facePhoto], ["📄 Pasport", detail.passportPhoto]].map(([lbl, src]) => (
            <div key={lbl}>
              <div style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{lbl}</div>
              <img src={src} alt={lbl} style={{ width: "100%", borderRadius: 16,
                border: "2px solid rgba(99,102,241,0.2)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0f1a,#111827)",
      fontFamily: "'Segoe UI',system-ui,sans-serif" }}>

      {/* Header */}
      <div style={{ background: "rgba(17,24,39,0.95)", backdropFilter: "blur(12px)",
        padding: "14px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", borderBottom: "1px solid rgba(99,102,241,0.12)",
        position: "sticky", top: 0, zIndex: 50 }}>
        <div>
          <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>👑 Boshliq paneli</div>
          <div style={{ color: "#a855f7", fontSize: 12, fontWeight: 600 }}>
            Jami: {records.length} • Bugun: {todayAll}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={exportCSV} style={{ padding: "8px 14px", background: "rgba(16,185,129,0.1)",
            color: "#10b981", border: "1.5px solid rgba(16,185,129,0.25)",
            borderRadius: 11, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
            ⬇ Excel
          </button>
          <button onClick={onLogout} style={{ padding: "8px 14px", background: "rgba(239,68,68,0.1)",
            color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.25)",
            borderRadius: 11, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Chiqish</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "18px 20px 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[
          { l: "Jami",  v: records.length, c: "#6366f1", i: "📊" },
          { l: "Bugun", v: todayAll,        c: "#10b981", i: "📅" },
          { l: "MFY",   v: [...new Set(records.map(r => r.mfy?.id))].filter(Boolean).length, c: "#f59e0b", i: "🏘️" },
        ].map((s, i) => (
          <div key={i} style={{ background: `rgba(${s.c === "#6366f1" ? "99,102,241" : s.c === "#10b981" ? "16,185,129" : "245,158,11"},0.08)`,
            borderRadius: 16, padding: "14px 10px", border: `1.5px solid ${s.c}22`, textAlign: "center" }}>
            <div style={{ fontSize: 20 }}>{s.i}</div>
            <div style={{ color: s.c, fontSize: 30, fontWeight: 900 }}>{s.v}</div>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Hodim progress */}
      <div style={{ padding: "18px 20px 0" }}>
        <h3 style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 800, margin: "0 0 12px" }}>👥 Hodimlar faolligi (bugun)</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hodimlar.map(([un, ud]) => {
            const todayCnt = records.filter(r => r.hodim === un && fmtDate(new Date(r.timestamp)) === todayStr()).length;
            const totalCnt = records.filter(r => r.hodim === un).length;
            const pct = Math.round((todayCnt / maxToday) * 100);
            return (
              <button key={un} onClick={() => { setHodimFilter(hodimFilter === un ? null : un); setTab("records"); }}
                style={{ padding: "12px 14px", background: hodimFilter === un ? "rgba(99,102,241,0.12)" : "rgba(17,24,39,0.5)",
                  border: hodimFilter === un ? "1.5px solid rgba(99,102,241,0.35)" : "1.5px solid rgba(99,102,241,0.1)",
                  borderRadius: 14, cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{ud.name}</span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    Bugun: <b style={{ color: "#10b981" }}>{todayCnt}</b> • Jami: <b style={{ color: "#818cf8" }}>{totalCnt}</b>
                  </span>
                </div>
                <div style={{ height: 6, background: "rgba(99,102,241,0.1)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, borderRadius: 6, transition: "width 0.6s ease",
                    background: todayCnt > 0 ? "linear-gradient(90deg,#6366f1,#10b981)" : "transparent" }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters + Search */}
      <div style={{ padding: "16px 20px 0" }}>
        {/* Search */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Ism, JSHSHIR yoki MFY qidirish..."
            style={{ width: "100%", padding: "12px 14px 12px 42px", background: "rgba(15,23,42,0.6)",
              border: "1.5px solid rgba(99,102,241,0.2)", borderRadius: 13, color: "#f1f5f9",
              fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Date filter */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[["all","Barchasi"],["today","Bugun"],["week","Hafta"]].map(([v, l]) => (
            <button key={v} onClick={() => setDateFilter(v)} style={{
              padding: "7px 16px", border: "none", borderRadius: 10, fontWeight: 600,
              fontSize: 12, cursor: "pointer",
              background: dateFilter === v ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(17,24,39,0.5)",
              color: dateFilter === v ? "#fff" : "#94a3b8" }}>
              {l}
            </button>
          ))}
          {hodimFilter && (
            <button onClick={() => setHodimFilter(null)} style={{
              padding: "7px 14px", background: "rgba(239,68,68,0.1)", color: "#ef4444",
              border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10,
              fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
              ✕ {USERS[hodimFilter]?.name}
            </button>
          )}
        </div>
      </div>

      {/* MFY chips */}
      {records.length > 0 && (
        <div style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 8 }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            <button onClick={() => setMfyFilter(null)} style={{
              padding: "6px 14px", border: "none", borderRadius: 10, fontSize: 11,
              fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              background: !mfyFilter ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(17,24,39,0.5)",
              color: !mfyFilter ? "#fff" : "#94a3b8" }}>Barcha MFY</button>
            {[...new Set(records.map(r => r.mfy?.id))].filter(Boolean).sort((a,b)=>a-b).map(id => (
              <button key={id} onClick={() => setMfyFilter(id === mfyFilter ? null : id)} style={{
                padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                whiteSpace: "nowrap", flexShrink: 0, borderRadius: 10,
                background: mfyFilter === id ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(17,24,39,0.5)",
                color: mfyFilter === id ? "#fff" : "#94a3b8",
                border: mfyFilter === id ? "none" : "1.5px solid rgba(99,102,241,0.1)" }}>
                {MFY_LIST.find(m => m.id === id)?.name?.split(" ")[0]} ({records.filter(r => r.mfy?.id === id).length})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Records */}
      <div style={{ padding: "8px 20px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 800, margin: 0 }}>
            📋 Yozuvlar <span style={{ color: "#475569", fontWeight: 500 }}>({filtered.length})</span>
          </h3>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#374151" }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>📭</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: "#475569" }}>Yozuvlar topilmadi</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...filtered].reverse().map((r, idx) => (
              <button key={r.id} onClick={() => setDetail(r)} style={{
                padding: "13px 14px", background: "rgba(17,24,39,0.6)",
                border: "1.5px solid rgba(99,102,241,0.08)", borderRadius: 16,
                cursor: "pointer", textAlign: "left", display: "flex", gap: 12,
                alignItems: "center" }}>
                <img src={r.facePhoto} alt="" style={{ width: 48, height: 48,
                  borderRadius: 12, objectFit: "cover",
                  border: "2px solid rgba(99,102,241,0.2)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.fullName}
                  </div>
                  <div style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 12,
                    letterSpacing: 1, marginTop: 2 }}>{r.jshshir}</div>
                  <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                    {r.mfy?.name} · {r.hodimName} · {fmt(r.timestamp)}
                  </div>
                </div>
                <span style={{ color: "#374151", fontSize: 20, fontWeight: 300, flexShrink: 0 }}>›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [records, setRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mfy_records") || "[]"); }
    catch { return []; }
  });

  const saveRecords = recs => {
    setRecords(recs);
    try { localStorage.setItem("mfy_records", JSON.stringify(recs)); } catch {}
  };

  if (!user) return <Login onLogin={setUser} />;
  if (user.role === "hodim") return (
    <Hodim user={user} records={records} setRecords={saveRecords} onLogout={() => setUser(null)} />
  );
  return <Boshliq user={user} records={records} onLogout={() => setUser(null)} />;
}
