import { useState, useEffect, useRef } from "react";
import Tesseract from "tesseract.js";
import { parse as parseMrzLib } from "mrz";
import { db, addRecord, listenRecords } from "./firebase";

// ─── Ma'lumotlar ──────────────────────────────────────────────────────────────
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

const fmt     = d => new Date(d).toLocaleTimeString("uz-UZ", { hour:"2-digit", minute:"2-digit" });
const fmtDate = d => new Date(d).toLocaleDateString("uz-UZ", { day:"2-digit", month:"2-digit", year:"numeric" });
const todayStr = () => fmtDate(new Date());

// ─── Ovoz ────────────────────────────────────────────────────────────────────
const playBeep = () => {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[523,0,0.12],[659,0.13,0.12],[784,0.26,0.22]].forEach(([f,t,d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.4, ac.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+t+d);
      o.start(ac.currentTime+t); o.stop(ac.currentTime+t+d+0.05);
    });
  } catch {}
};

// ─── Rasm ishlash ─────────────────────────────────────────────────────────────
// Sharpen filter (3×3 konvolyutsiya) — xira rasmlar uchun
const applySharpen = (ctx, w, h) => {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = new ImageData(w, h);
  const s = src.data, d = dst.data;
  const K = [0,-1,0,-1,5,-1,0,-1,0];
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let ky=-1; ky<=1; ky++)
          for (let kx=-1; kx<=1; kx++)
            v += s[((y+ky)*w+(x+kx))*4+c] * K[(ky+1)*3+(kx+1)];
        d[(y*w+x)*4+c] = Math.min(255, Math.max(0, v));
      }
      d[(y*w+x)*4+3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
};

// Aniqlik o'lchash (Laplacian variance) — xira kadrlarni o'tkazib yuborish
const sharpness = canvas => {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(Math.floor(w*0.25), Math.floor(h*0.25),
                              Math.floor(w*0.5),  Math.floor(h*0.5)).data;
  let s = 0;
  const W = Math.floor(w*0.5), H = Math.floor(h*0.5);
  for (let y=1; y<H-1; y++) {
    for (let x=1; x<W-1; x++) {
      const i=(y*W+x)*4;
      const g = p => 0.299*d[p]+0.587*d[p+1]+0.114*d[p+2];
      const l = Math.abs(4*g(i)-g(i-4)-g(i+4)-g((y-1)*W*4+x*4)-g((y+1)*W*4+x*4));
      s += l;
    }
  }
  return s / (W*H);
};

// Rasm: crop + zoom + kulrang + kontrast + sharpen
const enhance = (canvas, y0, y1) => {
  const sw=canvas.width, sh=canvas.height;
  const cy=Math.floor(sh*y0), ch=Math.floor(sh*(y1-y0));
  const S=3;
  const out=document.createElement("canvas");
  out.width=sw*S; out.height=ch*S;
  const ctx=out.getContext("2d");
  ctx.drawImage(canvas, 0,cy,sw,ch, 0,0,out.width,out.height);
  // Kulrang + kontrast
  const img=ctx.getImageData(0,0,out.width,out.height), d=img.data;
  for (let i=0;i<d.length;i+=4) {
    const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const v=g<105?Math.max(0,g*0.4):g>160?Math.min(255,g*1.3+15):(g-105)/55*255;
    d[i]=d[i+1]=d[i+2]=Math.round(v);
  }
  ctx.putImageData(img,0,0);
  // Sharpen (xira uchun)
  applySharpen(ctx, out.width, out.height);
  return out.toDataURL("image/png");
};

// ─── JSHSHIR yordamchi ────────────────────────────────────────────────────────
const isValidJ = n => {
  if (!/^[1-6]\d{13}$/.test(n)) return false;
  const mm=+n.slice(3,5), dd=+n.slice(5,7);
  return mm>=1&&mm<=12&&dd>=1&&dd<=31;
};
const capName = s => s?s.charAt(0).toUpperCase()+s.slice(1).toLowerCase():"";

// ─── PassportScanner ──────────────────────────────────────────────────────────
function PassportScanner({ onFound }) {
  const vRef    = useRef(null);
  const cRef    = useRef(null);
  const strmRef = useRef(null);
  const capRef  = useRef(null);
  const wRef    = useRef(null);
  const busy    = useRef(false);
  const done    = useRef(false);
  const tries   = useRef(0);
  const [status,  setStatus]  = useState("⏳ Kamera tayyorlanmoqda...");
  const [active,  setActive]  = useState(false);
  const [pulse,   setPulse]   = useState(false);
  const [ready,   setReady]   = useState(false);
  const [torch,   setTorch]   = useState(false);
  const [torchOk, setTorchOk] = useState(false);

  // ── Ovoz ──
  const playSuccess = playBeep;

  // ── QR kod (BarcodeDetector) ──
  const tryQR = async v => {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const det = new window.BarcodeDetector({ formats:["qr_code","pdf417","data_matrix"] });
      for (const code of await det.detect(v)) {
        const hits=[...code.rawValue.matchAll(/\d{14}/g)].map(m=>m[0]).filter(isValidJ);
        if (hits.length) return { j:hits[0], name:null };
      }
    } catch {}
    return null;
  };

  // ── MRZ library parse ──
  const tryMrz = text => {
    const lines = text.split("\n")
      .map(l=>l.replace(/[^A-Z0-9<]/g,"").trim())
      .filter(l=>l.length>=20);
    const getName = r => {
      if (!r?.fields?.firstName) return null;
      return `${capName(r.fields.firstName.split("<")[0])} ${capName(r.fields.lastName||"")}`.trim();
    };
    // TD1 — ID karta
    const td1 = lines.filter(l=>l.length>=28&&l.length<=32);
    if (td1.length>=3) {
      try {
        const r = parseMrzLib([td1[0].slice(0,30).padEnd(30,"<"),td1[1].slice(0,30).padEnd(30,"<"),td1[2].slice(0,30).padEnd(30,"<")]);
        const j = r?.fields?.personalNumber?.replace(/</g,"");
        if (j&&isValidJ(j)) return { j, name:getName(r) };
      } catch {}
    }
    // TD3 — Zagranpassport
    const td3 = lines.filter(l=>l.length>=40&&l.length<=48);
    if (td3.length>=2) {
      try {
        const r = parseMrzLib([td3[0].slice(0,44).padEnd(44,"<"),td3[1].slice(0,44).padEnd(44,"<")]);
        const j = r?.fields?.personalNumber?.replace(/</g,"");
        if (j&&isValidJ(j)) return { j, name:getName(r) };
      } catch {}
    }
    // Qo'lda
    for (const line of lines) {
      const hits=[...line.matchAll(/\d{14}/g)].map(m=>m[0]).filter(isValidJ);
      if (hits.length) {
        const m=line.match(/([A-Z]{2,})<<([A-Z]{2,})/);
        return { j:hits[0], name:m?`${capName(m[2])} ${capName(m[1])}`:null };
      }
    }
    return null;
  };

  // ── Torch ──
  const toggleTorch = async () => {
    const track = strmRef.current?.getVideoTracks()[0];
    if (!track) return;
    const newVal = !torch;
    try { await track.applyConstraints({ advanced:[{ torch:newVal }] }); setTorch(newVal); } catch {}
  };

  // ── Worker init ──
  useEffect(() => {
    let alive=true;
    Tesseract.createWorker("eng").then(async w => {
      try { await w.setParameters({ tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<" }); } catch {}
      if (!alive){w.terminate();return;}
      wRef.current=w; setReady(true); setStatus("Hujjatni kameraga tuting...");
    }).catch(()=>{ if(alive){setReady(true);setStatus("Hujjatni kameraga tuting...");} });
    return ()=>{ alive=false; wRef.current?.terminate(); };
  },[]);

  // ── Kamera ──
  useEffect(()=>{
    if(!ready) return;
    navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:{ideal:"environment"},
        width:{ideal:1920,min:1280}, height:{ideal:1080,min:720},
        advanced:[{focusMode:"continuous",exposureMode:"continuous",whiteBalanceMode:"continuous"}]
      }
    }).then(s=>{
      strmRef.current=s;
      const track=s.getVideoTracks()[0];
      if("ImageCapture" in window) capRef.current=new window.ImageCapture(track);
      const caps=track.getCapabilities?.();
      if(caps?.torch) setTorchOk(true);
      setTimeout(()=>{ if(vRef.current) vRef.current.srcObject=s; },100);
      setActive(true);
    }).catch(()=>setStatus("❌ Kamera ruxsati berilmadi!"));
    return ()=>strmRef.current?.getTracks().forEach(t=>t.stop());
  },[ready]);

  // ── Yuqori sifatli kadr ──
  const getFrame = async () => {
    if(capRef.current){
      try{
        const blob=await capRef.current.takePhoto();
        return new Promise(res=>{
          const img=new Image();
          img.onload=()=>{
            const c=document.createElement("canvas");
            c.width=img.width; c.height=img.height;
            c.getContext("2d").drawImage(img,0,0);
            res(c);
          };
          img.src=URL.createObjectURL(blob);
        });
      } catch {}
    }
    const v=vRef.current, c=cRef.current;
    if(!v||!c) return null;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    return c;
  };

  // ── Asosiy skaner ──
  const scan = async () => {
    if(busy.current||done.current) return;
    const v=vRef.current;
    if(!v||v.readyState<2) return;
    busy.current=true;
    tries.current++;
    setStatus(`🔍 Skanerlanmoqda... (${tries.current}-urinish)`);

    try {
      // 1) QR kod — eng tez
      const qr=await tryQR(v);
      if(qr?.j){ finish(qr.j,qr.name,null); return; }

      // Yuqori sifatli kadr
      const canvas=await getFrame();
      if(!canvas){ busy.current=false; return; }

      // Aniqlik tekshiruv — xira kadrni o'tkazib yuborish
      const sh=sharpness(canvas);
      if(sh<8&&tries.current<5){ setStatus(`📷 Kamerani tekis tuting... (${tries.current})`); busy.current=false; return; }

      const photo=canvas.toDataURL("image/jpeg",0.9);

      // 2) MRZ OCR (pastki 45%)
      const mrzImg=enhance(canvas,0.55,1.0);
      const rec=wRef.current
        ? await wRef.current.recognize(mrzImg)
        : await Tesseract.recognize(mrzImg,"eng");
      const mrz=tryMrz(rec.data.text);
      if(mrz?.j){ finish(mrz.j,mrz.name,photo); return; }

      setStatus(`📄 Pasportni yaqinroq va tekis tuting... (${tries.current})`);
    } catch {}
    busy.current=false;
  };

  const finish = (j,name,photo) => {
    done.current=true; playSuccess(); setPulse(true);
    strmRef.current?.getTracks().forEach(t=>t.stop());
    if(!photo){ const v=vRef.current,c=cRef.current; if(v&&c){c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);photo=c.toDataURL("image/jpeg",0.88);} }
    setTimeout(()=>onFound(j,name,photo),500);
  };

  useEffect(()=>{
    if(!active) return;
    const id=setInterval(scan,1800);
    return ()=>clearInterval(id);
  },[active]);

  return (
    <div>
      <div style={{position:"relative",borderRadius:16,overflow:"hidden",background:"#000",minHeight:200}}>
        {!ready&&(
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,background:"#0b1220"}}>
            <div style={{width:36,height:36,border:"3px solid #6366f1",borderTopColor:"transparent",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
            <span style={{color:"#6366f1",fontSize:13,fontWeight:600}}>OCR yuklanmoqda...</span>
          </div>
        )}
        <video ref={vRef} autoPlay playsInline muted style={{width:"100%",display:"block",maxHeight:280,objectFit:"cover",opacity:ready?1:0}}/>

        {/* Scan chizig'i */}
        {active&&!pulse&&(
          <div style={{position:"absolute",left:"4%",right:"4%",height:2.5,borderRadius:2,
            background:"linear-gradient(90deg,transparent,#6366f1,#06b6d4,#6366f1,transparent)",
            animation:"scanLine 1.8s ease-in-out infinite",boxShadow:"0 0 12px rgba(99,102,241,0.8)"}}/>
        )}

        {/* Muvaffaqiyat */}
        {pulse&&(
          <div style={{position:"absolute",inset:0,background:"rgba(34,197,94,0.25)",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn .4s"}}>
            <div style={{fontSize:72,animation:"popIn .4s ease"}}>✅</div>
          </div>
        )}

        {/* Burchak belgilari */}
        {[[{top:12,left:12},{borderTop:"2.5px solid #6366f1",borderLeft:"2.5px solid #6366f1"}],
          [{top:12,right:12},{borderTop:"2.5px solid #6366f1",borderRight:"2.5px solid #6366f1"}],
          [{bottom:12,left:12},{borderBottom:"2.5px solid #6366f1",borderLeft:"2.5px solid #6366f1"}],
          [{bottom:12,right:12},{borderBottom:"2.5px solid #6366f1",borderRight:"2.5px solid #6366f1"}]
        ].map(([pos,brd],i)=>(<div key={i} style={{position:"absolute",width:24,height:24,borderRadius:2,pointerEvents:"none",...pos,...brd}}/>))}

        {/* Torch tugmasi */}
        {torchOk&&active&&(
          <button onClick={toggleTorch} style={{position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",
            background:torch?"rgba(251,191,36,0.2)":"rgba(0,0,0,0.5)",color:torch?"#fbbf24":"#fff",
            border:`1.5px solid ${torch?"rgba(251,191,36,0.5)":"rgba(255,255,255,0.2)"}`,
            borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
            {torch?"🔦 Yoqiq":"🔦 Fonar"}
          </button>
        )}
      </div>
      <canvas ref={cRef} style={{display:"none"}}/>

      {/* Status */}
      <div style={{marginTop:8,padding:"10px 14px",background:"rgba(99,102,241,0.07)",
        border:"1px solid rgba(99,102,241,0.15)",borderRadius:12,
        display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:13,height:13,border:"2.5px solid #6366f1",borderTopColor:"transparent",
          borderRadius:"50%",animation:"spin .8s linear infinite",flexShrink:0}}/>
        <span style={{color:"#94a3b8",fontSize:12,fontWeight:600}}>{status}</span>
      </div>

      <style>{`
        @keyframes scanLine{0%{top:6%}50%{top:84%}100%{top:6%}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes popIn{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
      `}</style>
    </div>
  );
}

// ─── Camera (yuz rasmi) ───────────────────────────────────────────────────────
function Camera({ onCapture }) {
  const vRef=useRef(null), cRef=useRef(null);
  const [stream,setStream]=useState(null);
  const [on,setOn]=useState(false);
  const [img,setImg]=useState(null);
  const [cnt,setCnt]=useState(null);

  const start=async()=>{
    try{
      const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:640,height:480}});
      setStream(s); setOn(true);
      setTimeout(()=>{ if(vRef.current) vRef.current.srcObject=s; },100);
    }catch{ alert("Kamera ruxsati berilmadi!"); }
  };
  const stop=()=>{ stream?.getTracks().forEach(t=>t.stop()); setStream(null); setOn(false); };
  const snap=()=>{
    const v=vRef.current,c=cRef.current; if(!v||!c) return;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    const url=c.toDataURL("image/jpeg",.85);
    setImg(url); onCapture(url); stop();
  };
  const countdown=()=>{
    setCnt(3);
    const id=setInterval(()=>setCnt(p=>{ if(p<=1){clearInterval(id);snap();return null;} return p-1; }),1000);
  };
  const retake=()=>{ setImg(null); onCapture(null); start(); };
  useEffect(()=>()=>stream?.getTracks().forEach(t=>t.stop()),[stream]);

  if(img) return (
    <div style={{position:"relative"}}>
      <img src={img} alt="" style={{width:"100%",borderRadius:14,border:"2px solid #22c55e",objectFit:"cover",maxHeight:220}}/>
      <div style={{position:"absolute",top:10,right:10,background:"#22c55e",color:"#fff",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>✓ Saqlandi</div>
      <button onClick={retake} style={btnStyle("#ef4444","rgba(239,68,68,0.08)")}>🔄 Qayta olish</button>
    </div>
  );
  if(on) return (
    <div>
      <div style={{position:"relative",borderRadius:14,overflow:"hidden"}}>
        <video ref={vRef} autoPlay playsInline muted style={{width:"100%",display:"block",maxHeight:220,objectFit:"cover"}}/>
        {cnt&&<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:80,fontWeight:900,color:"#fff",animation:"popIn .4s"}}>{cnt}</span>
        </div>}
      </div>
      <canvas ref={cRef} style={{display:"none"}}/>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={countdown} disabled={!!cnt} style={btnStyle("#6366f1","linear-gradient(135deg,#6366f1,#8b5cf6)",true)}>
          📸 3... 2... 1...
        </button>
        <button onClick={snap} disabled={!!cnt} style={btnStyle("#6366f1","linear-gradient(135deg,#6366f1,#8b5cf6)",false,true)}>📸</button>
        <button onClick={stop} style={btnStyle("#ef4444","#ef4444",false,true)}>✕</button>
      </div>
    </div>
  );
  return (
    <button onClick={start} style={btnStyle("#6366f1","linear-gradient(135deg,#6366f1,#8b5cf6)",true)}>
      📷 Yuz rasmini olish
    </button>
  );
}

const btnStyle=(color,bg,full=false,sm=false)=>({
  width:full?"100%":"auto", padding:sm?"12px 16px":"13px 18px",
  background:bg, color:"#fff", border:"none", borderRadius:12,
  fontWeight:700, fontSize:14, cursor:"pointer", flex:full?undefined:1,
  boxShadow:`0 4px 12px ${color}33`
});

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [u,setU]=useState(""), [p,setP]=useState(""), [err,setErr]=useState(""), [loading,setLoading]=useState(false);
  const go=()=>{
    const x=USERS[u];
    if(x&&x.password===p){ setLoading(true); setTimeout(()=>onLogin({username:u,...x}),600); }
    else setErr("Login yoki parol noto'g'ri!");
  };
  const inp={padding:"14px 18px",background:"rgba(255,255,255,0.04)",border:"1.5px solid rgba(255,255,255,0.08)",
    borderRadius:14,color:"#f1f5f9",fontSize:15,outline:"none",width:"100%",boxSizing:"border-box",
    fontFamily:"inherit",transition:"border .2s"};
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0b1220 0%,#0f172a 50%,#0b1220 100%)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:380,animation:"slideUp .5s ease"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{width:80,height:80,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
            borderRadius:24,display:"flex",alignItems:"center",justifyContent:"center",
            margin:"0 auto 20px",fontSize:36,boxShadow:"0 20px 60px rgba(99,102,241,0.4)"}}>🏛️</div>
          <h1 style={{color:"#f1f5f9",fontSize:22,fontWeight:800,margin:0,letterSpacing:-.5}}>MFY Monitoring</h1>
          <p style={{color:"#475569",fontSize:13,marginTop:6,marginBottom:0}}>Fuqarolarni ro'yxatga olish tizimi</p>
        </div>

        {/* Form */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:24,padding:"32px 28px",
          border:"1px solid rgba(255,255,255,0.06)",backdropFilter:"blur(20px)"}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{color:"#64748b",fontSize:12,fontWeight:600,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.8}}>Login</label>
              <input value={u} onChange={e=>{setU(e.target.value);setErr("");}} placeholder="hodim1"
                style={inp} onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.08)"}/>
            </div>
            <div>
              <label style={{color:"#64748b",fontSize:12,fontWeight:600,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.8}}>Parol</label>
              <input type="password" value={p} onChange={e=>{setP(e.target.value);setErr("");}}
                placeholder="••••••" onKeyDown={e=>e.key==="Enter"&&go()} style={inp}
                onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.08)"}/>
            </div>
            {err&&<div style={{color:"#f87171",fontSize:13,padding:"10px 14px",background:"rgba(248,113,113,0.08)",borderRadius:10,border:"1px solid rgba(248,113,113,0.15)"}}>{err}</div>}
            <button onClick={go} disabled={loading} style={{marginTop:4,padding:15,
              background:loading?"#1e293b":"linear-gradient(135deg,#6366f1,#8b5cf6)",
              color:"#fff",border:"none",borderRadius:14,fontWeight:700,fontSize:15,cursor:loading?"wait":"pointer",
              boxShadow:"0 8px 24px rgba(99,102,241,0.3)",transition:"all .2s"}}>
              {loading?"Kirilmoqda...":"Kirish →"}
            </button>
          </div>
        </div>

        {/* Hint */}
        <div style={{marginTop:16,padding:"14px 18px",background:"rgba(255,255,255,0.02)",borderRadius:14,border:"1px solid rgba(255,255,255,0.05)"}}>
          <p style={{color:"#334155",fontSize:11,margin:"0 0 8px",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Demo</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:12,color:"#475569"}}>
            <span style={{fontFamily:"monospace"}}>admin / admin123</span><span style={{color:"#8b5cf6",fontWeight:600}}>Boshliq</span>
            <span style={{fontFamily:"monospace"}}>hodim1 / 1234</span><span style={{color:"#6366f1",fontWeight:600}}>Hodim</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hodim ────────────────────────────────────────────────────────────────────
function Hodim({ user, records, setRecords, onLogout }) {
  const [step,setStep]=useState("mfy");
  const [mfy,setMfy]=useState(null);
  const [face,setFace]=useState(null);
  const [passport,setPassport]=useState(null);
  const [name,setName]=useState("");
  const [jshshir,setJshshir]=useState("");
  const [coords,setCoords]=useState(null);
  const [sending,setSending]=useState(false);
  const [search,setSearch]=useState("");
  const [toast,setToast]=useState(null);
  const [success,setSuccess]=useState(null);

  useEffect(()=>{
    navigator.geolocation?.getCurrentPosition(
      p=>setCoords({lat:p.coords.latitude.toFixed(6),lng:p.coords.longitude.toFixed(6)}),
      ()=>setCoords({lat:"40.6367",lng:"71.5567"})
    );
  },[]);

  const myToday=records.filter(r=>r.hodim===user.username&&fmtDate(new Date(r.timestamp))===todayStr()).length;
  const show=(msg,type="ok")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  const onPassport=(j,fullName,photo)=>{
    setJshshir(j); setPassport(photo);
    if(fullName&&!name.trim()) setName(fullName);
    show("✅ JShShIR aniqlandi!");
  };

  const submit = async () => {
    if(!face||!passport||!name.trim()||jshshir.length!==14){show("Barcha maydonlarni to'ldiring!","err");return;}
    setSending(true);
    try {
      const rec = {
        id: Date.now(), hodim: user.username, hodimName: user.name, mfy,
        fullName: name.trim(), jshshir, facePhoto: face, passportPhoto: passport,
        coords, timestamp: new Date().toISOString()
      };

      // 1) Firebase ga saqlash
      await addRecord(rec);

      // 2) Telegram ga yuborish
      try {
        await fetch("/api/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record: rec, facePhoto: face, passportPhoto: passport }),
        });
      } catch {}

      setSuccess(rec);
      setFace(null); setPassport(null); setName(""); setJshshir(""); setStep("mfy");
    } catch (e) {
      show("Xatolik! Internet aloqasini tekshiring.", "err");
    }
    setSending(false);
  };

  const steps=[{ok:!!name.trim(),l:"FIO"},{ok:!!face,l:"Yuz"},{ok:!!passport,l:"Pasport"},{ok:jshshir.length===14,l:"JSHSHIR"}];
  const allOk=steps.every(s=>s.ok);
  const filtered=MFY_LIST.filter(m=>m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{minHeight:"100vh",background:"#0b1220",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#f1f5f9"}}>

      {/* Toast */}
      {toast&&<div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:999,
        background:toast.type==="err"?"linear-gradient(135deg,#ef4444,#dc2626)":"linear-gradient(135deg,#22c55e,#16a34a)",
        color:"#fff",padding:"12px 24px",borderRadius:14,fontWeight:700,fontSize:14,
        boxShadow:"0 8px 32px rgba(0,0,0,0.5)",maxWidth:"88vw",textAlign:"center",animation:"slideUp .3s"}}>
        {toast.msg}
      </div>}

      {/* Muvaffaqiyat */}
      {success&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1000,
        display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(12px)"}}>
        <div style={{background:"#111827",borderRadius:28,padding:"36px 28px",maxWidth:360,width:"100%",
          textAlign:"center",border:"1px solid rgba(34,197,94,0.2)",animation:"slideUp .4s",
          boxShadow:"0 0 80px rgba(34,197,94,0.1)"}}>
          <div style={{fontSize:64,marginBottom:16,animation:"popIn .5s"}}>🎉</div>
          <h2 style={{color:"#22c55e",fontSize:20,fontWeight:800,margin:"0 0 6px"}}>Muvaffaqiyatli!</h2>
          <p style={{color:"#64748b",fontSize:13,margin:"0 0 20px"}}>Ma'lumot tizimga saqlandi</p>
          <div style={{background:"rgba(34,197,94,0.06)",borderRadius:16,padding:"16px 18px",
            textAlign:"left",marginBottom:24,border:"1px solid rgba(34,197,94,0.1)"}}>
            <div style={{fontWeight:800,fontSize:17}}>{success.fullName}</div>
            <div style={{color:"#6366f1",fontFamily:"monospace",fontSize:14,letterSpacing:2,marginTop:4}}>{success.jshshir}</div>
            <div style={{color:"#64748b",fontSize:12,marginTop:4}}>{success.mfy?.name}</div>
          </div>
          <button onClick={()=>setSuccess(null)} style={{width:"100%",padding:14,
            background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",border:"none",
            borderRadius:14,fontWeight:800,fontSize:15,cursor:"pointer",
            boxShadow:"0 6px 20px rgba(34,197,94,0.3)"}}>
            ➕ Keyingi fuqaro
          </button>
        </div>
      </div>}

      {/* Header */}
      <div style={{background:"rgba(15,23,42,0.96)",backdropFilter:"blur(12px)",
        padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",
        borderBottom:"1px solid rgba(255,255,255,0.05)",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontWeight:700,fontSize:15}}>{user.name}</div>
          <div style={{color:"#6366f1",fontSize:11,fontWeight:600,marginTop:1}}>
            Bugun {myToday} ta • Jami {records.filter(r=>r.hodim===user.username).length} ta
          </div>
        </div>
        <button onClick={onLogout} style={{padding:"7px 16px",background:"rgba(239,68,68,0.08)",
          color:"#ef4444",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,fontWeight:600,fontSize:13,cursor:"pointer"}}>
          Chiqish
        </button>
      </div>

      {/* MFY tanlash */}
      {step==="mfy"&&<div style={{padding:20}}>
        <h2 style={{fontSize:20,fontWeight:800,margin:"0 0 4px"}}>MFY tanlang</h2>
        <p style={{color:"#475569",fontSize:13,margin:"0 0 16px"}}>Qaysi mahallaga borasiz?</p>
        <div style={{position:"relative",marginBottom:12}}>
          <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",color:"#475569"}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Qidirish..."
            style={{width:"100%",padding:"12px 14px 12px 40px",background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.07)",borderRadius:13,color:"#f1f5f9",
              fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:"66vh",overflowY:"auto"}}>
          {filtered.map(m=>{
            const cnt=records.filter(r=>r.mfy?.id===m.id&&r.hodim===user.username).length;
            return(
              <button key={m.id} onClick={()=>{setMfy(m);setStep("capture");}}
                style={{padding:"12px 16px",background:cnt>0?"rgba(99,102,241,0.07)":"rgba(255,255,255,0.03)",
                  border:cnt>0?"1px solid rgba(99,102,241,0.2)":"1px solid rgba(255,255,255,0.05)",
                  borderRadius:12,color:"#f1f5f9",fontWeight:600,fontSize:13,cursor:"pointer",
                  textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span><span style={{color:"#334155",marginRight:8,fontSize:11}}>{m.id}</span>{m.name}</span>
                {cnt>0&&<span style={{background:"rgba(99,102,241,0.15)",color:"#818cf8",padding:"2px 9px",borderRadius:8,fontSize:12,fontWeight:700}}>{cnt}</span>}
              </button>
            );
          })}
        </div>
      </div>}

      {/* Ma'lumot kiritish */}
      {step==="capture"&&<div style={{padding:20}}>
        <button onClick={()=>setStep("mfy")} style={{background:"none",border:"none",color:"#6366f1",fontWeight:600,fontSize:13,cursor:"pointer",padding:"0 0 16px",display:"flex",alignItems:"center",gap:4}}>← Orqaga</button>

        {/* MFY badge */}
        <div style={{background:"rgba(99,102,241,0.08)",borderRadius:16,padding:"14px 18px",marginBottom:22,border:"1px solid rgba(99,102,241,0.15)"}}>
          <div style={{color:"#6366f1",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5}}>Tanlangan MFY</div>
          <div style={{fontSize:17,fontWeight:800,marginTop:3}}>{mfy?.name}</div>
          {coords&&<div style={{color:"#475569",fontSize:11,marginTop:4}}>📍 {coords.lat}, {coords.lng}</div>}
        </div>

        {/* Progress steps */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:24}}>
          {steps.map((s,i)=>(
            <div key={i} style={{textAlign:"center"}}>
              <div style={{height:3,borderRadius:3,marginBottom:5,transition:"background .4s",
                background:s.ok?"#22c55e":"rgba(255,255,255,0.08)"}}/>
              <div style={{fontSize:10,fontWeight:600,color:s.ok?"#22c55e":"#334155"}}>{s.ok?"✓":i+1} {s.l}</div>
            </div>
          ))}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:20}}>
          {/* FIO */}
          <div>
            <label style={lbl}>👤 F.I.O (to'liq ism)</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ism sharifni kiriting"
              style={inputSt(!!name.trim())}/>
          </div>

          {/* Yuz */}
          <div>
            <label style={lbl}>🤳 Fuqaro yuz rasmi {face&&<span style={{color:"#22c55e",marginLeft:6}}>✓</span>}</label>
            <Camera onCapture={setFace}/>
          </div>

          {/* Pasport skaner */}
          <div>
            <label style={lbl}>📄 Hujjat skaneri (ID karta yoki Zagranpassport) {passport&&<span style={{color:"#22c55e",marginLeft:6}}>✓</span>}</label>
            <p style={{color:"#334155",fontSize:11,margin:"4px 0 10px"}}>Hujjatni kameraga tutsangiz avtomatik o'qiladi</p>
            {passport?(
              <div style={{position:"relative"}}>
                <img src={passport} alt="" style={{width:"100%",borderRadius:14,border:"2px solid #22c55e"}}/>
                <div style={{position:"absolute",top:10,right:10,background:"#22c55e",color:"#fff",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>✓ Aniqlandi</div>
                <button onClick={()=>{setPassport(null);setJshshir("");}} style={{marginTop:8,width:"100%",padding:10,background:"rgba(239,68,68,0.07)",color:"#ef4444",border:"1px solid rgba(239,68,68,0.2)",borderRadius:11,fontWeight:600,fontSize:13,cursor:"pointer"}}>🔄 Qayta skanerlash</button>
              </div>
            ):(
              <PassportScanner onFound={onPassport}/>
            )}
          </div>

          {/* JSHSHIR */}
          <div>
            <label style={lbl}>🔢 JShShIR — 14 raqam {jshshir.length===14&&<span style={{color:"#22c55e",marginLeft:6}}>✓ to'g'ri</span>}</label>
            <input value={jshshir} onChange={e=>{if(/^\d{0,14}$/.test(e.target.value))setJshshir(e.target.value);}}
              placeholder="Avtomatik yoki qo'lda" maxLength={14}
              style={{...inputSt(jshshir.length===14),fontSize:18,letterSpacing:3,fontFamily:"monospace",fontWeight:700}}/>
            {jshshir&&jshshir.length<14&&<div style={{color:"#f59e0b",fontSize:11,marginTop:5}}>{14-jshshir.length} ta raqam qoldi</div>}
          </div>

          {/* Submit */}
          <button onClick={submit} disabled={sending||!allOk}
            style={{padding:16,border:"none",borderRadius:16,fontWeight:800,fontSize:15,cursor:!allOk||sending?"default":"pointer",
              color:"#fff",transition:"all .2s",
              background:allOk&&!sending?"linear-gradient(135deg,#22c55e,#16a34a)":"rgba(255,255,255,0.05)",
              opacity:!allOk||sending?.5:1,
              boxShadow:allOk&&!sending?"0 8px 24px rgba(34,197,94,0.3)":"none"}}>
            {sending?"⏳ Saqlanmoqda...":"✅ Ma'lumotni yuborish"}
          </button>
        </div>
      </div>}
    </div>
  );
}

const lbl={color:"#64748b",fontSize:12,fontWeight:700,display:"block",marginBottom:8,textTransform:"uppercase",letterSpacing:.6};
const inputSt=ok=>({width:"100%",padding:"13px 16px",
  background:ok?"rgba(34,197,94,0.06)":"rgba(255,255,255,0.04)",
  border:`1.5px solid ${ok?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.07)"}`,
  borderRadius:13,color:"#f1f5f9",fontSize:15,outline:"none",boxSizing:"border-box",
  fontFamily:"inherit",transition:"all .2s"});

// ─── Boshliq ──────────────────────────────────────────────────────────────────
function Boshliq({ user, records, onLogout }) {
  const [hFilter,setHFilter]=useState(null);
  const [mFilter,setMFilter]=useState(null);
  const [dateF,setDateF]=useState("all");
  const [search,setSearch]=useState("");
  const [detail,setDetail]=useState(null);

  const hodimlar=Object.entries(USERS).filter(([,u])=>u.role==="hodim");
  const todayAll=records.filter(r=>fmtDate(new Date(r.timestamp))===todayStr()).length;

  const filtered=records.filter(r=>{
    if(hFilter&&r.hodim!==hFilter) return false;
    if(mFilter&&r.mfy?.id!==mFilter) return false;
    if(dateF==="today"&&fmtDate(new Date(r.timestamp))!==todayStr()) return false;
    if(dateF==="week"){const d=new Date();d.setDate(d.getDate()-7);if(new Date(r.timestamp)<d)return false;}
    if(search){const q=search.toLowerCase();if(!r.fullName?.toLowerCase().includes(q)&&!r.jshshir?.includes(q)&&!r.mfy?.name?.toLowerCase().includes(q))return false;}
    return true;
  });

  const exportCSV=()=>{
    const h=["#","Ism","JSHSHIR","MFY","Hodim","Sana","Vaqt","Joylashuv"];
    const rows=records.map((r,i)=>[i+1,r.fullName,r.jshshir,r.mfy?.name,r.hodimName,fmtDate(r.timestamp),fmt(r.timestamp),`${r.coords?.lat},${r.coords?.lng}`]);
    const csv=[h,...rows].map(r=>r.map(v=>`"${v||""}"`).join(",")).join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));
    a.download=`mfy_${todayStr().replace(/\./g,"-")}.csv`; a.click();
  };

  if(detail) return (
    <div style={{minHeight:"100vh",background:"#0b1220",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#f1f5f9"}}>
      <div style={{background:"rgba(15,23,42,0.96)",backdropFilter:"blur(12px)",padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.05)",position:"sticky",top:0,zIndex:50}}>
        <button onClick={()=>setDetail(null)} style={{background:"none",border:"none",color:"#6366f1",fontWeight:600,fontSize:14,cursor:"pointer",padding:0}}>← Orqaga</button>
      </div>
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:20,padding:"20px 18px",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontWeight:800,fontSize:20}}>{detail.fullName}</div>
              <div style={{color:"#6366f1",fontFamily:"monospace",fontSize:14,letterSpacing:2,marginTop:4}}>{detail.jshshir}</div>
            </div>
            <span style={{background:"rgba(99,102,241,0.12)",color:"#a5b4fc",padding:"6px 12px",borderRadius:10,fontSize:12,fontWeight:700}}>{detail.mfy?.name}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,color:"#64748b"}}>
            {[["📅",fmtDate(new Date(detail.timestamp))],["🕐",fmt(detail.timestamp)],["👤",detail.hodimName],["📍",`${detail.coords?.lat}, ${detail.coords?.lng}`]].map(([i,v],k)=>(
              <div key={k} style={{padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:10}}>{i} {v}</div>
            ))}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {[["🤳 Yuz",detail.facePhoto],["📄 Hujjat",detail.passportPhoto]].map(([l,s])=>(
            <div key={l}><div style={{color:"#64748b",fontSize:12,fontWeight:600,marginBottom:8}}>{l}</div>
            <img src={s} alt={l} style={{width:"100%",borderRadius:14,border:"1px solid rgba(255,255,255,0.08)"}}/></div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#0b1220",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#f1f5f9"}}>
      {/* Header */}
      <div style={{background:"rgba(15,23,42,0.96)",backdropFilter:"blur(12px)",padding:"14px 20px",
        display:"flex",justifyContent:"space-between",alignItems:"center",
        borderBottom:"1px solid rgba(255,255,255,0.05)",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontWeight:700,fontSize:15}}>👑 Boshqaruv paneli</div>
          <div style={{color:"#8b5cf6",fontSize:11,fontWeight:600,marginTop:1}}>Jami: {records.length} • Bugun: {todayAll}</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={exportCSV} style={{padding:"7px 14px",background:"rgba(34,197,94,0.08)",color:"#22c55e",border:"1px solid rgba(34,197,94,0.2)",borderRadius:10,fontWeight:600,fontSize:12,cursor:"pointer"}}>⬇ Excel</button>
          <button onClick={onLogout} style={{padding:"7px 14px",background:"rgba(239,68,68,0.08)",color:"#ef4444",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,fontWeight:600,fontSize:13,cursor:"pointer"}}>Chiqish</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{padding:"16px 20px 0",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        {[["📊","Jami",records.length,"#6366f1"],["📅","Bugun",todayAll,"#22c55e"],["🏘️","MFY",[...new Set(records.map(r=>r.mfy?.id))].filter(Boolean).length,"#f59e0b"]].map(([icon,l,v,c],i)=>(
          <div key={i} style={{background:`${c}0d`,borderRadius:16,padding:"14px 10px",border:`1px solid ${c}22`,textAlign:"center"}}>
            <div style={{fontSize:20}}>{icon}</div>
            <div style={{color:c,fontSize:28,fontWeight:900}}>{v}</div>
            <div style={{color:"#475569",fontSize:11,fontWeight:600}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Hodimlar */}
      <div style={{padding:"16px 20px 0"}}>
        <div style={{color:"#475569",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:10}}>Hodimlar (bugun)</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {hodimlar.map(([un,ud])=>{
            const today=records.filter(r=>r.hodim===un&&fmtDate(new Date(r.timestamp))===todayStr()).length;
            const total=records.filter(r=>r.hodim===un).length;
            const max=Math.max(1,...hodimlar.map(([u])=>records.filter(r=>r.hodim===u&&fmtDate(new Date(r.timestamp))===todayStr()).length));
            return(
              <button key={un} onClick={()=>setHFilter(hFilter===un?null:un)}
                style={{padding:"12px 14px",background:hFilter===un?"rgba(99,102,241,0.1)":"rgba(255,255,255,0.03)",
                  border:hFilter===un?"1px solid rgba(99,102,241,0.3)":"1px solid rgba(255,255,255,0.05)",
                  borderRadius:14,cursor:"pointer",textAlign:"left"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{color:"#f1f5f9",fontWeight:600,fontSize:13}}>{ud.name}</span>
                  <span style={{color:"#475569",fontSize:12}}>Bugun <b style={{color:"#22c55e"}}>{today}</b> · Jami <b style={{color:"#818cf8"}}>{total}</b></span>
                </div>
                <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.round(today/max*100)}%`,borderRadius:4,transition:"width .6s",
                    background:today>0?"linear-gradient(90deg,#6366f1,#22c55e)":"transparent"}}/>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter */}
      <div style={{padding:"14px 20px 0"}}>
        <div style={{position:"relative",marginBottom:10}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#475569",fontSize:14}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ism, JSHSHIR yoki MFY..."
            style={{width:"100%",padding:"11px 14px 11px 38px",background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,color:"#f1f5f9",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["all","Barchasi"],["today","Bugun"],["week","Hafta"]].map(([v,l])=>(
            <button key={v} onClick={()=>setDateF(v)} style={{padding:"6px 14px",border:"none",borderRadius:9,fontWeight:600,fontSize:12,cursor:"pointer",
              background:dateF===v?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.05)",color:dateF===v?"#fff":"#64748b"}}>{l}</button>
          ))}
          {hFilter&&<button onClick={()=>setHFilter(null)} style={{padding:"6px 12px",background:"rgba(239,68,68,0.08)",color:"#ef4444",border:"1px solid rgba(239,68,68,0.2)",borderRadius:9,fontWeight:600,fontSize:11,cursor:"pointer"}}>✕ {USERS[hFilter]?.name}</button>}
        </div>
      </div>

      {/* Yozuvlar */}
      <div style={{padding:"12px 20px 32px"}}>
        <div style={{color:"#334155",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:.8,marginBottom:10}}>
          Yozuvlar ({filtered.length})
        </div>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:48,color:"#1e293b"}}>
            <div style={{fontSize:40,marginBottom:12}}>📭</div>
            <div style={{fontWeight:600,color:"#334155"}}>Yozuvlar topilmadi</div>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[...filtered].reverse().map(r=>(
              <button key={r.id} onClick={()=>setDetail(r)}
                style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",
                  border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,
                  cursor:"pointer",textAlign:"left",display:"flex",gap:12,alignItems:"center"}}>
                <img src={r.facePhoto} alt="" style={{width:46,height:46,borderRadius:12,objectFit:"cover",border:"1px solid rgba(255,255,255,0.08)",flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.fullName}</div>
                  <div style={{color:"#6366f1",fontFamily:"monospace",fontSize:11,letterSpacing:1,marginTop:2}}>{r.jshshir}</div>
                  <div style={{color:"#334155",fontSize:11,marginTop:2}}>{r.mfy?.name} · {r.hodimName} · {fmt(r.timestamp)}</div>
                </div>
                <span style={{color:"#1e293b",fontSize:18}}>›</span>
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
  const [user,setUser]=useState(null);
  const [records,setRecords]=useState([]);

  // Firebase real-time
  useEffect(()=>{
    const unsub = listenRecords(setRecords);
    return ()=>unsub();
  },[]);

  if(!user) return <Login onLogin={setUser}/>;
  if(user.role==="hodim") return <Hodim user={user} records={records} setRecords={setRecords} onLogout={()=>setUser(null)}/>;
  return <Boshliq user={user} records={records} onLogout={()=>setUser(null)}/>;
}
