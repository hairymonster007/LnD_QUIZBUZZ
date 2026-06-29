import { useState, useEffect, useRef } from "react";
import { 
  Tv, 
  User, 
  Users, 
  Copy, 
  Check, 
  RotateCcw, 
  Trash2, 
  Volume2, 
  VolumeX, 
  Crown, 
  AlertCircle, 
  ArrowRight,
  Info,
  QrCode
} from "lucide-react";

interface GameState {
  isLocked: boolean;
  firstBuzzer: string | null;
  buzzedAt: number | null;
  players: string[];
  roundId: number;
}

export default function App() {
  const [role, setRole] = useState<"select" | "host" | "player">("select");
  const [playerName, setPlayerName] = useState<string>("");
  const [hasJoined, setHasJoined] = useState<boolean>(false);
  const [inputName, setInputName] = useState<string>("");
  
  // Game state synced with server
  const [gameState, setGameState] = useState<GameState>({
    isLocked: false,
    firstBuzzer: null,
    buzzedAt: null,
    players: [],
    roundId: 1
  });

  const [copied, setCopied] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [buzzStatus, setBuzzStatus] = useState<"idle" | "buzzing" | "success" | "fail">("idle");

  const prevStateRef = useRef<GameState | null>(null);

  // Parse URL parameters on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get("role");
    if (roleParam === "host") {
      setRole("host");
    } else if (roleParam === "player") {
      setRole("player");
      // Check if player name exists in localStorage
      const savedName = localStorage.getItem("buzzer_player_name");
      if (savedName) {
        setInputName(savedName);
        setPlayerName(savedName);
        setHasJoined(true);
        // Automatically register to server
        joinGame(savedName);
      }
    }
  }, []);

  // Sync state via SSE and Fallback Polling
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    const fetchState = async () => {
      try {
        const res = await fetch("/api/state");
        if (!res.ok) throw new Error("取得狀態失敗");
        const data = await res.json();
        setGameState(data);
        setApiError(null);
      } catch (err) {
        console.error("Error fetching state:", err);
        setApiError("與伺服器連線中斷，正在重新連線...");
      }
    };

    const connectSSE = () => {
      if (eventSource) {
        eventSource.close();
      }

      eventSource = new EventSource("/api/stream");
      
      eventSource.onopen = () => {
        setSseConnected(true);
        setApiError(null);
        // Stop polling once connected to SSE
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setGameState(data);
          setApiError(null);
        } catch (e) {
          console.error("Error parsing SSE data", e);
        }
      };

      eventSource.onerror = () => {
        setSseConnected(false);
        eventSource?.close();
        
        // Start polling fallback if not already polling
        if (!pollInterval) {
          pollInterval = setInterval(fetchState, 1500);
        }
        
        // Retry SSE connection after 5 seconds
        setTimeout(connectSSE, 5000);
      };
    };

    // Initial fetch and setup
    fetchState();
    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Web Audio Synthesizers for Sound Effects
  const playBuzzSound = () => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Sound 1: Buzzer sound
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(120, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.3);

      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(122, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(182, ctx.currentTime + 0.3);

      gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.4);
      osc2.stop(ctx.currentTime + 0.4);
    } catch (e) {
      console.warn("AudioContext failed:", e);
    }
  };

  const playResetSound = () => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15); // E5

      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (e) {
      console.warn("AudioContext failed:", e);
    }
  };

  // Sound effect trigger effect (Host only)
  useEffect(() => {
    if (gameState) {
      if (prevStateRef.current) {
        // Detect transitions
        if (!prevStateRef.current.isLocked && gameState.isLocked) {
          if (role === "host") {
            playBuzzSound();
          }
        }
        if (prevStateRef.current.roundId !== gameState.roundId) {
          if (role === "host") {
            playResetSound();
          }
        }
      }
      prevStateRef.current = gameState;
    }
  }, [gameState, role, soundEnabled]);

  // Join API Call
  const joinGame = async (name: string) => {
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        localStorage.setItem("buzzer_player_name", name);
        setPlayerName(name);
        setHasJoined(true);
        setApiError(null);
      } else {
        const data = await res.json();
        setApiError(data.error || "加入失敗");
      }
    } catch (err) {
      console.error(err);
      setApiError("無法連接至伺服器");
    }
  };

  // Buzz API Call
  const buzzIn = async () => {
    if (gameState.isLocked || buzzStatus === "buzzing") return;

    setBuzzStatus("buzzing");
    
    // Tactile vibration on mobile devices
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(120);
    }

    try {
      const res = await fetch("/api/buzz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: playerName })
      });
      
      const data = await res.json();
      if (data.success && data.isFirst) {
        setBuzzStatus("success");
      } else {
        setBuzzStatus("fail");
      }
    } catch (err) {
      console.error(err);
      setBuzzStatus("idle");
      setApiError("搶答失敗，連線異常");
    }
  };

  // Reset local buzz status on next round
  useEffect(() => {
    if (!gameState.isLocked) {
      setBuzzStatus("idle");
    }
  }, [gameState.isLocked, gameState.roundId]);

  // Host Reset Game State
  const resetBuzzer = async () => {
    try {
      await fetch("/api/reset", { method: "POST" });
    } catch (err) {
      console.error(err);
    }
  };

  // Host Clear All Players
  const clearAllPlayers = async () => {
    if (confirm("確定要清除目前所有玩家並重新開始嗎？")) {
      try {
        await fetch("/api/clear-all", { method: "POST" });
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Copy join link helper
  const copyJoinLink = () => {
    const link = `${window.location.origin}/?role=player`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const playerJoinUrl = `${window.location.origin}/?role=player`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(playerJoinUrl)}`;

  return (
    <div className="min-h-screen bg-[#F9F9F9] text-[#111111] font-sans transition-all duration-300">
      
      {/* Top Warning/Error Alerts */}
      {apiError && (
        <div className="bg-[#111111] text-[#86BC25] text-xs font-mono py-2 px-4 flex items-center justify-center gap-2 border-b border-[#86BC25]/20 animate-pulse">
          <AlertCircle className="w-4 h-4" />
          <span>{apiError}</span>
        </div>
      )}

      {/* RENDER VIEW 1: Role Selection */}
      {role === "select" && (
        <div className="flex flex-col items-center justify-center min-h-screen p-6">
          <div className="w-full max-w-md bg-white border border-gray-200 shadow-sm rounded-2xl p-8 transition-all hover:shadow-md">
            
            {/* Deloitte Green Accent Dot */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <span className="text-xl font-display font-bold tracking-tight">Interactive Buzzer</span>
                <span className="w-2.5 h-2.5 bg-[#86BC25] rounded-full inline-block animate-pulse"></span>
              </div>
              <span className="text-xs text-gray-400 font-mono">v1.1.0</span>
            </div>

            <div className="space-y-3 mb-8">
              <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight leading-tight">
                線上互動搶答平台
              </h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                一個即時、流暢的搶答系統，適用於會議、活動、工作坊等現場互動。
              </p>
            </div>

            <div className="space-y-4">
              <button
                id="btn-select-host"
                onClick={() => setRole("host")}
                className="w-full h-14 bg-[#111111] hover:bg-[#222222] text-white font-medium rounded-xl flex items-center justify-between px-6 transition-all transform hover:-translate-y-0.5 active:translate-y-0 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <Tv className="w-5 h-5 text-[#86BC25]" />
                  <span className="font-medium">開啟主持者主螢幕</span>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400" />
              </button>

              <button
                id="btn-select-player"
                onClick={() => setRole("player")}
                className="w-full h-14 bg-white hover:bg-gray-50 text-gray-900 border border-gray-200 font-medium rounded-xl flex items-center justify-between px-6 transition-all transform hover:-translate-y-0.5 active:translate-y-0 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-[#86BC25]" />
                  <span className="font-medium">加入成為搶答玩家</span>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400" />
              </button>
            </div>


          </div>
        </div>
      )}

      {/* RENDER VIEW 2: Host Console */}
      {role === "host" && (
        <div className="max-w-7xl mx-auto p-6 md:p-10 min-h-screen flex flex-col justify-between">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-gray-200">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 bg-[#86BC25] rounded-full animate-ping"></span>
                <span className="text-xs font-mono font-medium tracking-widest text-[#86BC25] uppercase">
                  Round {gameState.roundId} • Live Connection
                </span>
              </div>
              <h2 className="text-3xl font-display font-bold tracking-tight text-gray-900">
                線上互動搶答室控制台
              </h2>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Sound Toggle */}
              <button
                id="btn-host-toggle-sound"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-3 rounded-xl border transition-all ${
                  soundEnabled 
                    ? "bg-white border-gray-200 text-gray-700 hover:bg-gray-50" 
                    : "bg-gray-100 border-gray-200 text-gray-400"
                }`}
                title={soundEnabled ? "音效已開啟" : "音效已關閉"}
              >
                {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </button>

              <button
                id="btn-host-back"
                onClick={() => {
                  window.history.pushState({}, "", "/");
                  setRole("select");
                }}
                className="px-4 py-2.5 bg-white text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 transition-all text-gray-600"
              >
                返回主頁
              </button>
            </div>
          </div>

          {/* Main Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 my-8 flex-grow items-stretch">
            
            {/* Left Box: Active State Screen (6 columns) */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="flex-grow bg-white border border-gray-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-sm relative overflow-hidden">
                
                {/* Visual state effect background */}
                {gameState.isLocked && (
                  <div className="absolute inset-0 bg-[#86BC25]/5 animate-pulse pointer-events-none"></div>
                )}

                {!gameState.isLocked ? (
                  <div className="space-y-6 max-w-sm">
                    <div className="w-20 h-20 bg-gray-50 border border-gray-100 rounded-full flex items-center justify-center mx-auto shadow-inner animate-pulse">
                      <div className="w-5 h-5 bg-[#86BC25] rounded-full"></div>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-display font-bold text-gray-900">等待搶答中...</h3>
                      <p className="text-sm text-gray-400 leading-relaxed">
                        請玩家點擊手機上的搶答按鈕。第一個按下的玩家名字將會立刻顯示在下方！
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8 py-6 w-full animate-fade-in">
                    <div className="w-24 h-24 bg-[#86BC25]/10 border border-[#86BC25]/20 rounded-full flex items-center justify-center mx-auto shadow-sm">
                      <Crown className="w-12 h-12 text-[#86BC25]" />
                    </div>
                    
                    <div className="space-y-3">
                      <span className="text-xs font-mono font-bold tracking-widest text-[#86BC25] uppercase">
                        恭喜！首位搶答成功
                      </span>
                      <h1 className="text-6xl font-display font-black text-gray-950 tracking-tight leading-tight px-4 break-words">
                        {gameState.firstBuzzer}
                      </h1>
                    </div>

                    <div className="inline-flex items-center gap-2.5 px-4 py-2 bg-gray-50 border border-gray-100 rounded-full text-xs text-gray-400 font-mono">
                      <span>已自動鎖定，其他玩家無法重複搶答</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Box: QR Code and Players List (5 columns) */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              
              {/* QR Code Card */}
              <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 tracking-tight mb-4 flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-[#86BC25]" />
                  <span>掃描 QR Code 進入搶答室</span>
                </h4>

                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="w-32 h-32 sm:w-36 sm:h-36 border border-gray-100 rounded-xl p-2 bg-white shrink-0 flex items-center justify-center shadow-inner">
                    <img
                      src={qrCodeUrl}
                      alt="Player Join QR Code"
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  <div className="space-y-3 flex-grow text-center sm:text-left">
                    <p className="text-xs text-gray-500 leading-relaxed">
                      請投放到投影螢幕上，玩家使用手機鏡頭掃描即可加入。
                    </p>
                    <div className="flex flex-col gap-2">
                      <div className="bg-gray-50 px-3 py-2 border border-gray-150 rounded-lg text-xs font-mono truncate text-gray-600 select-all">
                        {playerJoinUrl}
                      </div>
                      <button
                        id="btn-host-copy-link"
                        onClick={copyJoinLink}
                        className="h-9 px-4 text-xs font-medium bg-[#111111] hover:bg-[#222222] text-white rounded-lg flex items-center justify-center gap-1.5 transition-all w-full sm:w-auto"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#86BC25]" />
                            <span>已複製！</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>複製加入連結</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Players Card */}
              <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex-grow flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
                    <h4 className="text-sm font-bold text-gray-900 tracking-tight flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#86BC25]" />
                      <span>已加入的玩家</span>
                    </h4>
                    <span className="text-xs font-mono font-bold bg-gray-50 border border-gray-100 px-2 py-0.5 rounded text-gray-600">
                      {gameState.players.length} 人
                    </span>
                  </div>

                  {gameState.players.length === 0 ? (
                    <div className="py-12 text-center space-y-2">
                      <Users className="w-8 h-8 text-gray-200 mx-auto" />
                      <p className="text-xs text-gray-400">目前尚無玩家加入，等待中...</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto pr-1">
                      {gameState.players.map((name, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-1.5 bg-[#F4F4F4] hover:bg-gray-200 border border-gray-200 rounded-lg text-xs font-medium text-gray-800 flex items-center gap-1.5 transition-all"
                        >
                          <span className="w-1.5 h-1.5 bg-[#86BC25] rounded-full"></span>
                          <span>{name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Operations */}
                <div className="pt-6 border-t border-gray-100 mt-6 grid grid-cols-2 gap-3">
                  <button
                    id="btn-host-reset-buzzer"
                    onClick={resetBuzzer}
                    className="h-12 bg-[#86BC25] hover:bg-[#72a11f] text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5 active:translate-y-0 shadow-sm"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>重置搶答 (下一輪)</span>
                  </button>
                  
                  <button
                    id="btn-host-clear-players"
                    onClick={clearAllPlayers}
                    className="h-12 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-200 rounded-xl flex items-center justify-center gap-2 transition-all"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                    <span>清空所有玩家</span>
                  </button>
                </div>

              </div>

            </div>

          </div>

          {/* Footer Branding */}
          <div className="text-center text-xs text-gray-400 border-t border-gray-100 pt-6">
            <p>© 2026 線上互動搶答平台 • Deloitte 企業綠極簡美學設計</p>
          </div>
        </div>
      )}

      {/* RENDER VIEW 3: Player View */}
      {role === "player" && (
        <div className="max-w-md mx-auto p-6 min-h-screen flex flex-col justify-between">
          
          {/* Brand/Logo header */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-200">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-display font-extrabold tracking-tight">Interactive Buzzer</span>
              <span className="w-2 h-2 bg-[#86BC25] rounded-full"></span>
            </div>
            
            <button
              id="btn-player-exit"
              onClick={() => {
                if (confirm("確定要離開搶答室嗎？")) {
                  window.history.pushState({}, "", "/");
                  setRole("select");
                  setHasJoined(false);
                  setPlayerName("");
                  localStorage.removeItem("buzzer_player_name");
                }
              }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-all"
            >
              登出 / 離開
            </button>
          </div>

          {/* JOIN SCREEN */}
          {!hasJoined ? (
            <div className="my-auto py-8">
              <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm space-y-6">
                
                <div className="space-y-2">
                  <h3 className="text-2xl font-display font-bold text-gray-900 tracking-tight">
                    輸入暱稱加入搶答
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    請輸入一個獨特的名字，好讓主持者在搶答成功時一眼認出你！
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 tracking-wide block uppercase">
                      玩家姓名 / 暱稱
                    </label>
                    <input
                      id="input-player-name"
                      type="text"
                      maxLength={15}
                      value={inputName}
                      onChange={(e) => setInputName(e.target.value)}
                      placeholder="例如：大雄 / Andy"
                      className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-[#86BC25] focus:bg-white text-sm font-medium transition-all"
                    />
                  </div>

                  <button
                    id="btn-player-join"
                    onClick={() => {
                      if (inputName.trim() === "") {
                        alert("請先輸入您的暱稱");
                        return;
                      }
                      joinGame(inputName);
                    }}
                    className="w-full h-12 bg-[#111111] hover:bg-[#222222] text-white font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <span>加入搶答室</span>
                    <ArrowRight className="w-4 h-4 text-[#86BC25]" />
                  </button>
                </div>

              </div>
            </div>
          ) : (
            /* ACTIVE BUZZER SCREEN */
            <div className="my-auto py-8 flex flex-col items-center justify-center space-y-8">
              
              {/* Player Welcome Card */}
              <div className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2 h-2 bg-[#86BC25] rounded-full animate-pulse"></span>
                  <p className="text-xs text-gray-500 font-medium truncate">
                    已連線：<span className="text-gray-900 font-bold">{playerName}</span>
                  </p>
                </div>
                <div className="text-xs font-mono font-bold bg-gray-50 border border-gray-100 px-2 py-0.5 rounded text-gray-500 shrink-0">
                  共 {gameState.players.length} 人在線
                </div>
              </div>

              {/* The Big Buzzer Trigger Container */}
              <div className="relative flex items-center justify-center w-full py-10">
                
                {/* 1. STATE: IDLE / READY TO BUZZ */}
                {!gameState.isLocked ? (
                  <button
                    id="btn-player-buzz-trigger"
                    onClick={buzzIn}
                    className="w-64 h-64 md:w-72 md:h-72 rounded-full bg-[#86BC25] hover:bg-[#72a11f] active:scale-95 text-white font-display font-black text-4xl shadow-xl shadow-[#86BC25]/20 flex flex-col items-center justify-center gap-1 transition-all duration-150 relative cursor-pointer group select-none"
                  >
                    {/* Ring glow pulse */}
                    <span className="absolute inset-0 rounded-full border border-white/20 scale-100 group-hover:scale-105 transition-all duration-300"></span>
                    <span className="absolute -inset-4 rounded-full border border-[#86BC25]/10 scale-100 group-hover:scale-105 animate-pulse"></span>
                    
                    <span>搶！</span>
                    <span className="text-xs font-mono font-normal tracking-widest text-white/70 uppercase">
                      READY TO BUZZ
                    </span>
                  </button>
                ) : (
                  /* 2. STATE: LOCKED */
                  <div className="flex flex-col items-center justify-center">
                    
                    {/* Locked Status sub-views */}
                    {gameState.firstBuzzer === playerName ? (
                      /* LOCKED - YOU WIN */
                      <div className="space-y-4 text-center">
                        <div className="w-64 h-64 md:w-72 md:h-72 rounded-full bg-white border-4 border-[#86BC25] flex flex-col items-center justify-center gap-3 shadow-lg animate-bounce">
                          <Crown className="w-16 h-16 text-[#86BC25] animate-pulse" />
                          <div className="space-y-1">
                            <h2 className="text-3xl font-display font-black text-gray-900">恭喜！</h2>
                            <p className="text-xs font-bold text-[#86BC25] tracking-widest uppercase">
                              你是第一名！
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* LOCKED - OTHER WINS */
                      <div className="space-y-6 text-center">
                        <div className="w-64 h-64 md:w-72 md:h-72 rounded-full bg-gray-100 border border-gray-200 flex flex-col items-center justify-center gap-2 shadow-inner text-gray-400 select-none">
                          <span className="text-sm font-bold uppercase tracking-widest text-gray-400">
                            搶答已鎖定
                          </span>
                          <span className="text-lg font-bold text-gray-500">
                            首位：{gameState.firstBuzzer}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 font-medium">
                          請等待主持者重置，開始下一輪搶答！
                        </p>
                      </div>
                    )}

                  </div>
                )}
                
              </div>

              {/* Status Message */}
              <div className="text-center">
                {!gameState.isLocked ? (
                  <p className="text-xs text-[#86BC25] font-bold tracking-wider animate-pulse flex items-center justify-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[#86BC25] rounded-full"></span>
                    <span>隨時注意！準備搶答！</span>
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">
                    等待主持者進到下一題...
                  </p>
                )}
              </div>

            </div>
          )}

          {/* Footer */}
          <div className="text-center text-[10px] text-gray-400 pt-4 border-t border-gray-100">
            <p>Deloitte 企業線上即時搶答系統 • 僅限同場域互動</p>
          </div>

        </div>
      )}

    </div>
  );
}
