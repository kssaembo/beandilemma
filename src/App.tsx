/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  Crown, Timer, Key, Users, Lock, Unlock, Award, CheckCircle2, Copy, 
  Play, RefreshCw, BookOpen, Printer, HelpCircle, Shield, Sparkles,
  ArrowRight, ArrowLeft, Send, Check, Eye, Trash2, UserCheck, AlertCircle,
  XCircle, Database, Download, EyeOff, Settings, Tablet, Tv, QrCode
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { doc, getDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { GameStatus, GameState, Player, RoundRecord } from './types';
import { SyncBridge, db } from './syncBridge';

// 3D Shiny Single Bean Icon component
const SingleBeanIcon = ({ className = "w-10 h-10" }: { className?: string }) => (
  <svg 
    viewBox="0 0 100 100" 
    className={`inline-block select-none ${className}`}
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <radialGradient id="beanGradient" cx="45%" cy="40%" r="55%">
        <stop offset="0%" stopColor="#FBBF24" />
        <stop offset="60%" stopColor="#D97706" />
        <stop offset="100%" stopColor="#92400E" />
      </radialGradient>
    </defs>
    <path 
      d="M 50,15 
         C 78,15 88,40 82,65 
         C 76,82 55,87 45,80 
         C 35,74 42,58 32,50 
         C 22,42 22,15 50,15 Z" 
      fill="url(#beanGradient)" 
      stroke="#78350F" 
      strokeWidth="4" 
      strokeLinejoin="round"
    />
    <path 
      d="M 62,28 C 72,36 72,50 67,58" 
      stroke="#FFFFFF" 
      strokeWidth="5" 
      strokeLinecap="round" 
      opacity="0.8"
    />
  </svg>
);

// Initial default state helper
const createInitialState = (roomCode: string, masterPw: string): GameState => ({
  roomCode,
  masterPassword: masterPw || '1234',
  status: GameStatus.SETTING,
  players: [],
  currentRound: 1,
  totalRounds: 5,
  timeLimit: 120,
  timeLeft: 120,
  timerActive: false,
  redWins: 0,
  whiteWins: 0,
  roundHistory: [],
  showRoundResult: false,
  lastUpdated: Date.now(),
  winnerTeam: null,
  mvp: null,
  revealMvp: false,
  gameOverStep: 'LAST_ROUND'
});

export default function App() {
  // Navigation & Local view state
  const [view, setView] = useState<'HOME' | 'PRE_SETTING' | 'DISPLAY' | 'STUDENT_LOBBY' | 'STUDENT_ACTIVE_CABINET' | 'ADMIN_CONTROLLER'>('HOME');
  
  // Game settings / UI states
  const [role, setRole] = useState<'HOST' | 'CLIENT' | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [lobbyError, setLobbyError] = useState('');
  const [showDisplayConnectModal, setShowDisplayConnectModal] = useState(false);
  const [showStudentConnectModal, setShowStudentConnectModal] = useState(false);
  const [showTempDisplayAlert, setShowTempDisplayAlert] = useState(false);
  
  // Game Start branching modals & state
  const [showGameStartModal, setShowGameStartModal] = useState(false);
  const [showContinueGameModal, setShowContinueGameModal] = useState(false);
  const [continueRoomCode, setContinueRoomCode] = useState('');
  const [continuePassword, setContinuePassword] = useState('');
  const [continueError, setContinueError] = useState('');
  const [isConnectingContinue, setIsConnectingContinue] = useState(false);

  // Cabinet focus ref
  const cabinetPasswordInputRef = useRef<HTMLInputElement>(null);
  
  // Rule guide modal state
  const [showGuide, setShowGuide] = useState(false);
  const [guideSlide, setGuideSlide] = useState(0);
  
  // Players text inputs (newline separated)
  const [playersText, setPlayersText] = useState(
    "이준석\n홍진호\n이상민\n강용석\n김구라\n차유람\n성규\n임윤선"
  );
  const [teamAllocationMode, setTeamAllocationMode] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [masterPasswordSetting, setMasterPasswordSetting] = useState('1234');
  
  // Custom states for Pre-Setting page
  const [tempPlayers, setTempPlayers] = useState<Player[]>([]);
  const [hasAllocatedTeams, setHasAllocatedTeams] = useState(false);
  const [timerMinutesSetting, setTimerMinutesSetting] = useState(2);
  const [preSettingRoomCode, setPreSettingRoomCode] = useState('');
  const [showPDFPopup, setShowPDFPopup] = useState(false);
  
  // Active states
  const [gameState, setGameState] = useState<GameState>(() => createInitialState('', ''));
  const [authPlayerId, setAuthPlayerId] = useState<string | null>(null);
  const [cabinetPasswordInput, setCabinetPasswordInput] = useState('');
  const [cabinetAuthError, setCabinetAuthError] = useState('');
  const [showCabinetAuthModal, setShowCabinetAuthModal] = useState<string | null>(null); // Player ID
  const [showCabinetConfirmModal, setShowCabinetConfirmModal] = useState<Player | null>(null); // Confirm player cabinet modal
  
  // Student interaction states
  const [cabinetBeansLeft, setCabinetBeansLeft] = useState(0);
  const [cabinetBeansSubmitted, setCabinetBeansSubmitted] = useState(0);

  // Sync bridge ref
  const syncBridgeRef = useRef<SyncBridge | null>(null);
  const timerRef = useRef<any>(null);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Use a ref for role to prevent stale closures in MQTT/Sync callbacks
  const roleRef = useRef<string | null>(role);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  // Autofocus student cabinet password input on click
  useEffect(() => {
    if (showCabinetAuthModal) {
      setTimeout(() => {
        cabinetPasswordInputRef.current?.focus();
      }, 80);
    }
  }, [showCabinetAuthModal]);

  // -------------------------------------------------------------
  // Real-time synchronization helper (Triggered when GameState updates as HOST)
  // -------------------------------------------------------------
  const broadcastLatestState = (updatedState: GameState) => {
    const stateWithTimestamp = {
      ...updatedState,
      lastUpdated: Date.now()
    };
    setGameState(stateWithTimestamp);
    if (syncBridgeRef.current && roleRef.current === 'HOST') {
      syncBridgeRef.current.broadcastState(stateWithTimestamp);
    }
  };

  const broadcastMqttState = (updatedState: GameState) => {
    const stateWithTimestamp = {
      ...updatedState,
      lastUpdated: Date.now()
    };
    if (syncBridgeRef.current && roleRef.current === 'HOST') {
      syncBridgeRef.current.broadcastState(stateWithTimestamp);
    }
  };

  // -------------------------------------------------------------
  // Handler for incoming state updates from Host (For CLIENT/Students & Multi-Host Display/Admin Boards)
  // -------------------------------------------------------------
  const handleIncomingState = (incoming: GameState) => {
    setGameState(prev => {
      // 1. If we don't have a room code yet, we must accept it
      if (!prev.roomCode) {
        return incoming;
      }

      // 2. CLIENT (student tablets) and passive viewers (DISPLAY/projector view) must ALWAYS mirror the server/host's state perfectly
      if (roleRef.current === 'CLIENT' || view === 'DISPLAY') {
        return incoming;
      }

      // 3. For any other role, if the incoming state is strictly newer (by timestamp), we accept it immediately
      if (incoming.lastUpdated > prev.lastUpdated) {
        return incoming;
      }

      return prev;
    });

    // If we are currently looking at a cabinet, sync its limits
    if (authPlayerId) {
      const activePlayer = incoming.players.find(p => p.id === authPlayerId);
      if (activePlayer) {
        // If the round has ended, close active cabinet
        if (incoming.status === GameStatus.ROUND_ENDED || incoming.status === GameStatus.GAME_OVER) {
          setView('STUDENT_LOBBY');
          setAuthPlayerId(null);
        }
      }
    }
  };

  // -------------------------------------------------------------
  // Handler for Client Events (For HOST - like voting/answers)
  // -------------------------------------------------------------
  const handleClientEvent = (event: { type: string; playerId: string; beans?: number; name?: string }) => {
    if (roleRef.current !== 'HOST') return;

    setGameState(prev => {
      // 1. Submit beans action
      if (event.type === 'SUBMIT_BEANS') {
        const targetPlayer = prev.players.find(p => p.id === event.playerId);
        if (!targetPlayer || targetPlayer.submittedThisRound) return prev;

        const updatedPlayers = prev.players.map(p => {
          if (p.id === event.playerId) {
            const beansVal = event.beans ?? 0;
            const finalBeans = Math.min(beansVal, p.beansInCabinet);
            return {
              ...p,
              submittedThisRound: true,
              submittedBeansThisRound: finalBeans,
              beansInCabinet: p.beansInCabinet - finalBeans
            };
          }
          return p;
        });

        const nextState = {
          ...prev,
          players: updatedPlayers,
          lastUpdated: Date.now()
        };

        // If all players have registered their choices, auto pause timer or let host handle
        broadcastMqttState(nextState);
        return nextState;
      }

      if (event.type === 'CLIENT_CONNECT') {
        // A client device connected, broadcast the latest complete state to keep them synced immediately
        setTimeout(() => {
          broadcastMqttState(prev);
        }, 50);
        return prev;
      }

      return prev;
    });
  };

  // -------------------------------------------------------------
  // Setup sync connection
  // -------------------------------------------------------------
  const establishSync = (code: string, currentRole: 'HOST' | 'CLIENT') => {
    if (syncBridgeRef.current) {
      syncBridgeRef.current.destroy();
    }

    setSyncError(null);

    const bridge = new SyncBridge(
      code,
      currentRole === 'HOST' ? 'HOST' : 'CLIENT',
      handleIncomingState,
      handleClientEvent,
      (err) => {
        setSyncError(err.message || '알 수 없는 Firebase 연결 오류가 발생했습니다.');
        setMqttConnected(false);
      }
    );

    syncBridgeRef.current = bridge;
    setMqttConnected(true);

    // Periodic connection check
    const checker = setInterval(() => {
      if (syncBridgeRef.current) {
        setMqttConnected(syncBridgeRef.current.getBrokerStatus());
      }
    }, 3000);

    return () => {
      clearInterval(checker);
      bridge.destroy();
    };
  };

  // 1s Timer Effect (Silky-smooth local interpolation on ALL screens to avoid network jitter and double ticking)
  useEffect(() => {
    let interval: any = null;
    if (gameState.timerActive && gameState.timeLeft > 0 && gameState.status === GameStatus.PLAYING) {
      interval = setInterval(() => {
        setGameState(prev => {
          if (prev.timeLeft <= 1) {
            const finishedState: GameState = {
              ...prev,
              timeLeft: 0,
              timerActive: false,
              status: GameStatus.ROUND_ENDED,
              lastUpdated: Date.now()
            };
            if (roleRef.current === 'HOST') {
              broadcastMqttState(finishedState);
            }
            return finishedState;
          }
          
          return {
            ...prev,
            timeLeft: prev.timeLeft - 1
          };
        });
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [gameState.timerActive, role, gameState.status]);

  // Clean sync on unmount
  useEffect(() => {
    return () => {
      if (syncBridgeRef.current) syncBridgeRef.current.destroy();
    };
  }, []);

  // Scan URL query parameters on mount to support mobile admin and tablet secret room QR routes
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const isAdmin = params.get('admin') === 'true';
      const code = params.get('roomCode') || params.get('room') || '';
      const mode = params.get('mode');
      const paramView = params.get('view');

      if (isAdmin && code) {
        setRole('HOST');
        setView('ADMIN_CONTROLLER');
        setRoomCodeInput(code);
        establishSync(code, 'HOST');
      } else if (code && (mode === 'secret_room' || paramView === 'STUDENT_LOBBY')) {
        setRole('CLIENT');
        setView('STUDENT_LOBBY');
        setRoomCodeInput(code);
        establishSync(code, 'CLIENT');
      }
    } catch (err) {
      console.error('URL query parameters boot error:', err);
    }
  }, []);

  // -------------------------------------------------------------
  // LOBBY & ROUTING ACTIONS
  // -------------------------------------------------------------
  const generateRandomCode = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  };

  const handleStartButton = () => {
    // Generate a random default room code and clear errors
    setRoomCodeInput('');
    setLobbyError('');
    // Trigger popup modal inside Lobby
    setShowGuide(false);
  };

  // 진입 구조: [비밀의 공간(설정 겸용)]
  const enterStudentLobby = () => {
    setRole('CLIENT');
    setLobbyError('');
    if (!roomCodeInput) {
      // Create local setup mode without broker if code is empty until setup is saved
      setView('PRE_SETTING');
    } else {
      // Connect to existing room
      const roundedCode = roomCodeInput.trim();
      if (roundedCode.length !== 4 || isNaN(Number(roundedCode))) {
        setLobbyError('기기 연결 코드 4자리를 정확히 입력해주세요.');
        return;
      }
      setView('STUDENT_LOBBY');
      establishSync(roundedCode, 'CLIENT');
    }
  };

  // 진입 구조: [게임 전광판]
  const enterDisplayBoard = () => {
    setLobbyError('');
    const roundedCode = roomCodeInput.trim();
    if (!roundedCode) {
      setLobbyError('전광판을 가동하려면 교사의 4자리 [기기 연결 코드]를 먼저 입력하거나 방을 개설해야 합니다.');
      return;
    }

    if (masterPasswordInput !== gameState.masterPassword && masterPasswordInput !== masterPasswordSetting) {
      setLobbyError('교사용 마스터 보안 패스워드가 다릅니다. 올바른 패스워드를 입력하세요.');
      return;
    }

    setRole('HOST');
    setView('DISPLAY');
    establishSync(roundedCode, 'HOST');
    setShowDisplayConnectModal(false);
    
    // Broadcast initial state once connected only if we have active setup data locally
    setTimeout(() => {
      if (gameState.roomCode && gameState.players.length > 0) {
        broadcastLatestState(gameState);
      }
    }, 1000);
  };

  // Continue existing game room setup handler
  const handleContinueGameConnect = async () => {
    const code = continueRoomCode.trim();
    const pw = continuePassword.trim();
    if (!code) {
      setContinueError('게임방 번호 4자리를 입력해 주세요.');
      return;
    }
    if (code.length !== 4 || isNaN(Number(code))) {
      setContinueError('게임방 번호 4자리를 정확히 입력해 주세요.');
      return;
    }
    if (!pw) {
      setContinueError('마스터 비밀번호를 입력해 주세요.');
      return;
    }
    
    setIsConnectingContinue(true);
    setContinueError('');
    try {
      const roomDoc = await getDoc(doc(db, 'rooms', code));
      if (!roomDoc.exists()) {
        setContinueError('해당 게임방 번호가 존재하지 않습니다.');
        setIsConnectingContinue(false);
        return;
      }
      const data = roomDoc.data() as GameState;
      if (data.masterPassword !== pw) {
        setContinueError('마스터 비밀번호가 일치하지 않습니다.');
        setIsConnectingContinue(false);
        return;
      }
      
      // Successfully connected: load state and register client roles
      setGameState(data);
      setRole('CLIENT');
      setView('STUDENT_LOBBY');
      establishSync(code, 'CLIENT');
      setShowContinueGameModal(false);
    } catch (err: any) {
      setContinueError('연결 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsConnectingContinue(false);
    }
  };

  // CSV Download handler
  const handleDownloadCSV = () => {
    try {
      if (!gameState || !gameState.roomCode) {
        alert('다운로드할 게임 데이터가 없습니다.');
        return;
      }

      // Helper to escape CSV values
      const escape = (val: string | number) => {
        const text = String(val).replace(/"/g, '""');
        return `"${text}"`;
      };

      const rows: string[] = [];

      // 1. Title & Meta
      rows.push(`${escape('=== 콩의 딜레마 게임 결과 리포트 ===')}`);
      rows.push(`${escape('방 코드')},${escape(gameState.roomCode)}`);
      rows.push(`${escape('교사용 마스터 비밀번호')},${escape(gameState.masterPassword)}`);
      rows.push(`${escape('출력 일시')},${escape(new Date().toLocaleString())}`);
      
      // Winner team
      let winnerStr = '진행중';
      if (gameState.status === GameStatus.GAME_OVER) {
        if (gameState.winnerTeam === 'RED') winnerStr = 'RED팀 최종 대승리';
        else if (gameState.winnerTeam === 'WHITE') winnerStr = 'WHITE팀 최종 대승리';
        else if (gameState.winnerTeam === 'DRAW') winnerStr = '양 팀 무승부';
      }
      rows.push(`${escape('최종 승리팀')},${escape(winnerStr)}`);
      rows.push(`${escape('레드팀 승리 라운드 수')},${escape(gameState.redWins)}`);
      rows.push(`${escape('화이트팀 승리 라운드 수')},${escape(gameState.whiteWins)}`);
      rows.push(''); // Empty line

      // 2. Round Summaries
      rows.push(`${escape('--- 라운드 요약 ---')}`);
      rows.push([
        escape('라운드'),
        escape('레드팀 총 제출 콩'),
        escape('화이트팀 총 제출 콩'),
        escape('라운드 우승팀'),
        escape('패배팀/무승부 제출 콩')
      ].join(','));

      gameState.roundHistory.forEach(rec => {
        let recWinner = '';
        if (rec.winnerTeam === 'RED') recWinner = 'RED';
        else if (rec.winnerTeam === 'WHITE') recWinner = 'WHITE';
        else if (rec.winnerTeam === 'DRAW') recWinner = '무승부(DRAW)';

        rows.push([
          escape(rec.round),
          escape(rec.redTotalSubmitted),
          escape(rec.whiteTotalSubmitted),
          escape(recWinner),
          escape(rec.defeatedTeamTotalBeans)
        ].join(','));
      });
      rows.push(''); // Empty line

      // 3. Player Submissions Per Round
      rows.push(`${escape('--- 플레이어별 세부 제출 기록 ---')}`);
      
      // Determine columns up to the total rounds or current history rounds
      const maxRoundsRecorded = Math.max(gameState.roundHistory.length, 1);
      const roundHeaders: string[] = [];
      for (let r = 1; r <= maxRoundsRecorded; r++) {
        roundHeaders.push(escape(`${r}라운드 제출`));
      }

      rows.push([
        escape('플레이어 이름'),
        escape('소속 팀'),
        ...roundHeaders,
        escape('사물함 남은 콩')
      ].join(','));

      gameState.players.forEach(p => {
        const playerRoundBeans: string[] = [];
        for (let r = 1; r <= maxRoundsRecorded; r++) {
          const rec = gameState.roundHistory.find(h => h.round === r);
          const sub = rec?.playerSubmissions?.find(s => s.name === p.name);
          if (sub) {
            playerRoundBeans.push(escape(sub.beans));
          } else {
            // If they are on this round currently but it's not archived yet, we can check current round info
            if (r === gameState.currentRound && p.submittedThisRound) {
              playerRoundBeans.push(escape(p.submittedBeansThisRound));
            } else {
              playerRoundBeans.push(escape('-'));
            }
          }
        }

        rows.push([
          escape(p.name),
          escape(p.team === 'RED' ? '레드팀(RED)' : '화이트팀(WHITE)'),
          ...playerRoundBeans,
          escape(p.beansInCabinet)
        ].join(','));
      });

      // Export file
      const csvContent = '\uFEFF' + rows.join('\n'); // Add BOM for Excel Korean support
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `beans_dilemma_room_${gameState.roomCode}_results.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert('CSV 다운로드 중 오류가 발생했습니다: ' + err);
    }
  };

  // -------------------------------------------------------------
  // SETUP (사전 설정 페이지) - 기능 가공 및 활성화
  // -------------------------------------------------------------
  const generatePassword = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  };

  const handleStartTeamAllocation = () => {
    const rawNames = playersText.split('\n')
      .map(n => n.trim())
      .filter(n => n.length > 0);

    if (rawNames.length < 2) {
      alert('최소 2명 이상의 플레이어가 필요합니다.');
      return;
    }

    const newPlayers: Player[] = rawNames.map((name, index) => {
      return {
        id: `player_${index + 1}_${Date.now()}_${Math.random().toString(16).slice(2,6)}`,
        name,
        team: '' as any, // initial neutral/unassigned
        password: generatePassword(),
        beansInCabinet: 10,
        submittedThisRound: false,
        submittedBeansThisRound: 0
      };
    });

    if (teamAllocationMode === 'AUTO') {
      const shuffled = [...newPlayers].sort(() => Math.random() - 0.5);
      shuffled.forEach((p, idx) => {
        p.team = idx < shuffled.length / 2 ? 'WHITE' : 'RED';
      });
      // Sort nicely or keep shuffled
      setTempPlayers(shuffled);
    } else {
      // Manual begins with neutral unassigned team
      setTempPlayers(newPlayers);
    }

    if (!preSettingRoomCode) {
      setPreSettingRoomCode(generateRandomCode());
    }

    setHasAllocatedTeams(true);
  };

  const setupPlayers = () => {
    let finalPlayers = [...tempPlayers];

    if (finalPlayers.length === 0 || !hasAllocatedTeams) {
      alert('팀 배정 시작 버튼을 먼저 클릭하여 팀 배정을 완료해주세요!');
      return;
    }

    // Checking if all players have their team defined (for manual mode especially)
    const unallocated = finalPlayers.some(p => !p.team);
    if (unallocated) {
      alert('모든 플레이어의 팀(화이트/레드)을 지정해야 시작할 수 있습니다.');
      return;
    }

    const generatedCode = preSettingRoomCode || generateRandomCode();
    const setupState: GameState = {
      roomCode: generatedCode,
      masterPassword: masterPasswordSetting || '1234',
      status: GameStatus.PLAYING, // Starts immediately
      currentRound: 1,
      totalRounds: 5,
      timeLimit: timerMinutesSetting * 60, // set customized time
      timeLeft: timerMinutesSetting * 60,
      timerActive: false,
      players: finalPlayers,
      redWins: 0,
      whiteWins: 0,
      roundHistory: [],
      showRoundResult: false,
      lastUpdated: Date.now(),
      winnerTeam: null,
      mvp: null
    };

    setGameState(setupState);
    setRole('HOST'); // Host controls game progression
    setView('STUDENT_LOBBY'); // Student view becomes playable inside this browser tab
    
    // Connect sync logic using generated code
    establishSync(generatedCode, 'HOST');
    
    // Slow broadcast to make sure broker connection succeeds
    setTimeout(() => {
      if (syncBridgeRef.current) {
        syncBridgeRef.current.broadcastState(setupState);
      }
    }, 1500);
  };

  const togglePlayerTeam = (playerId: string) => {
    setGameState(prev => {
      const updated = prev.players.map(p => {
        if (p.id === playerId) {
          return { ...p, team: p.team === 'RED' ? 'WHITE' : ('RED' as any) };
        }
        return p;
      });
      const next = { ...prev, players: updated };
      broadcastMqttState(next);
      return next;
    });
  };

  const removePlayer = (playerId: string) => {
    setGameState(prev => {
      const filtered = prev.players.filter(p => p.id !== playerId);
      const next = { ...prev, players: filtered };
      broadcastMqttState(next);
      return next;
    });
  };

  const triggerPrintSecrets = () => {
    setShowPDFPopup(true);
  };

  // -------------------------------------------------------------
  // STUDENT VIEW - 사물함 제어 및 콩 투표
  // -------------------------------------------------------------
  const attemptOpenCabinet = (player: Player) => {
    if (player.submittedThisRound) {
      alert('이번 라운드에 콩을 이미 제출하셨습니다!');
      return;
    }
    setShowCabinetConfirmModal(player);
  };

  const handleVerifyCabinetPassword = () => {
    if (!showCabinetAuthModal) return;
    const player = gameState.players.find(p => p.id === showCabinetAuthModal);
    if (!player) return;

    if (cabinetPasswordInput === player.password || cabinetPasswordInput === '0000') { // 0000 is bypass master password for teachers
      setAuthPlayerId(player.id);
      setCabinetBeansLeft(player.beansInCabinet);
      setCabinetBeansSubmitted(0);
      setView('STUDENT_ACTIVE_CABINET');
      setShowCabinetAuthModal(null);
    } else {
      setCabinetAuthError('비밀번호 4자리가 일치하지 않습니다.');
    }
  };

  const submitCabinetChoice = () => {
    if (!authPlayerId) return;
    const player = gameState.players.find(p => p.id === authPlayerId);
    if (!player) return;

    // Send submit choice to sync bridge
    if (syncBridgeRef.current) {
      syncBridgeRef.current.sendClientAction({
        type: 'CLIENT_SUBMIT',
        playerId: player.id,
        beans: cabinetBeansSubmitted
      });
    }

    // Direct local optimistic state update for instant client responsive feedback
    setGameState(prev => {
      const updated = prev.players.map(p => {
        if (p.id === player.id) {
          return {
            ...p,
            submittedThisRound: true,
            submittedBeansThisRound: cabinetBeansSubmitted,
            beansInCabinet: p.beansInCabinet - cabinetBeansSubmitted
          };
        }
        return p;
      });
      return { ...prev, players: updated };
    });

    // Close cabinet with clean state
    setView('STUDENT_LOBBY');
    setAuthPlayerId(null);
    setCabinetBeansSubmitted(0);
  };

  const handleCopyClipboardLedger = () => {
    const list = tempPlayers.length > 0 ? tempPlayers : gameState.players;
    if (list.length === 0) {
      alert("등록된 플레이어 정보가 없습니다.");
      return;
    }
    
    let text = "번호\t이름\t소속 팀\t사물함 비밀번호\n";
    list.forEach((p, idx) => {
      const teamStr = p.team === 'RED' ? 'RED' : p.team === 'WHITE' ? 'WHITE' : '미정';
      text += `${idx + 1}\t${p.name}\t${teamStr}\t${p.password}\n`;
    });
    
    try {
      navigator.clipboard.writeText(text).then(() => {
        alert("📋 [복사 성공] 플레이어 정보 및 비밀번호 대장이 클립보드에 표 형식으로 복사되었습니다!\n\n한컴오피스 한글, MS 엑셀, 혹은 메모장에 커서를 두고 붙여넣기(Ctrl+V) 하시면 완벽하게 정돈됩니다.");
      }).catch(() => {
        // Fallback for some sandboxed scenarios
        alert("클립보드 API가 제한되었습니다. 출력창의 텍스트를 마우스로 직접 드래그하여 복사해 주세요.");
      });
    } catch (e) {
      alert("클립보드 API 연동 오류가 발생했습니다. 수동으로 복사하여 활용해 주세요.");
    }
  };

  // -------------------------------------------------------------
  // GAME ADMIN ACTIONS (전광판 제어 및 기보 정산)
  // -------------------------------------------------------------
  const handleToggleTimer = () => {
    const next = { ...gameState, timerActive: !gameState.timerActive };
    broadcastLatestState(next);
  };

  const handleResetTimer = () => {
    const next = { ...gameState, timeLeft: gameState.timeLimit, timerActive: false };
    broadcastLatestState(next);
  };

  const handleImmediateRoundEnd = () => {
    const next = {
      ...gameState,
      timeLeft: 0,
      timerActive: false,
      status: GameStatus.ROUND_ENDED
    };
    broadcastLatestState(next);
  };

  const handleEndGameImmediately = () => {
    if (!window.confirm('정말로 게임을 종료하시겠습니까? 현재 라운드까지의 성적(승부 수)을 기준으로 최종 우승팀과 MVP 학생이 즉시 결정 및 게재됩니다.')) return;
    
    setGameState(prev => {
      let finalWinnerTeam: 'RED' | 'WHITE' | 'DRAW' | null = null;
      let mvpLeaders: any[] | null = null;

      if (prev.redWins > prev.whiteWins) {
        finalWinnerTeam = 'RED';
      } else if (prev.whiteWins > prev.redWins) {
        finalWinnerTeam = 'WHITE';
      } else {
        finalWinnerTeam = 'DRAW';
      }

      // Calculate MVP: players on the winning team (or all players if draw) with the most beans left in cabinet
      const eligibilityTeam = finalWinnerTeam === 'DRAW' ? null : finalWinnerTeam;
      const eligiblePlayers = eligibilityTeam 
        ? prev.players.filter(p => p.team === eligibilityTeam)
        : prev.players;

      if (eligiblePlayers.length > 0) {
        const maxRemainingBeans = Math.max(...eligiblePlayers.map(p => p.beansInCabinet));
        const mvps = eligiblePlayers.filter(p => p.beansInCabinet === maxRemainingBeans);
        mvpLeaders = mvps.map(p => ({
          name: p.name,
          team: p.team,
          beansLeft: p.beansInCabinet
        }));
      } else {
        const maxRemainingBeans = Math.max(...prev.players.map(p => p.beansInCabinet));
        const mvps = prev.players.filter(p => p.beansInCabinet === maxRemainingBeans);
        mvpLeaders = mvps.map(p => ({
          name: p.name,
          team: p.team,
          beansLeft: p.beansInCabinet
        }));
      }

      const endedState: GameState = {
        ...prev,
        status: GameStatus.GAME_OVER,
        timerActive: false,
        winnerTeam: finalWinnerTeam,
        mvp: mvpLeaders,
        lastUpdated: Date.now()
      };

      if (syncBridgeRef.current && roleRef.current === 'HOST') {
        syncBridgeRef.current.broadcastState(endedState);
      }
      return endedState;
    });
  };

  const handleRevealRoundResult = () => {
    setGameState(prev => {
      // 정산 로직 구동
      let redTotal = 0;
      let whiteTotal = 0;

      prev.players.forEach(p => {
        if (p.team === 'RED') redTotal += p.submittedBeansThisRound;
        if (p.team === 'WHITE') whiteTotal += p.submittedBeansThisRound;
      });

      let winner: 'RED' | 'WHITE' | 'DRAW' = 'DRAW';
      let defeatedTeamBeans = 0;

      if (redTotal > whiteTotal) {
        winner = 'RED';
        defeatedTeamBeans = whiteTotal;
      } else if (whiteTotal > redTotal) {
        winner = 'WHITE';
        defeatedTeamBeans = redTotal;
      } else {
        winner = 'DRAW';
        defeatedTeamBeans = redTotal; // tie equals either values
      }

      // Record round
      const newRecord: RoundRecord = {
        round: prev.currentRound,
        redTotalSubmitted: redTotal,
        whiteTotalSubmitted: whiteTotal,
        winnerTeam: winner,
        defeatedTeamTotalBeans: defeatedTeamBeans,
        playerSubmissions: prev.players.map(p => ({
          name: p.name,
          team: p.team,
          beans: p.submittedBeansThisRound
        }))
      };

      const updatedHistory = [...prev.roundHistory, newRecord];

      // Update scores
      let nextRedWins = prev.redWins;
      let nextWhiteWins = prev.whiteWins;
      if (winner === 'RED') nextRedWins += 1;
      if (winner === 'WHITE') nextWhiteWins += 1;

      // Check if team won (Best of 5. 즉 3승 선승자)
      let finalWinnerTeam: 'RED' | 'WHITE' | 'DRAW' | null = null;
      let mvpLeaders: any[] | null = null;
      let nextStatus = prev.status;

      if (nextRedWins >= 3) {
        finalWinnerTeam = 'RED';
        nextStatus = GameStatus.GAME_OVER;
      } else if (nextWhiteWins >= 3) {
        finalWinnerTeam = 'WHITE';
        nextStatus = GameStatus.GAME_OVER;
      } else if (prev.currentRound >= prev.totalRounds) {
        // Round max reached
        if (nextRedWins > nextWhiteWins) {
          finalWinnerTeam = 'RED';
        } else if (nextWhiteWins > nextRedWins) {
          finalWinnerTeam = 'WHITE';
        } else {
          finalWinnerTeam = 'DRAW';
        }
        nextStatus = GameStatus.GAME_OVER;
      }

      if (finalWinnerTeam) {
        // MVP calculation: 승리 팀원 중 사물함 콩 잔량이 가장 많은 사람
        const winnerTeamPlayers = prev.players.filter(p => p.team === finalWinnerTeam);
        if (winnerTeamPlayers.length > 0) {
          const maxRemainingBeans = Math.max(...winnerTeamPlayers.map(p => p.beansInCabinet));
          const mvps = winnerTeamPlayers.filter(p => p.beansInCabinet === maxRemainingBeans);
          mvpLeaders = mvps.map(p => ({
            name: p.name,
            team: p.team,
            beansLeft: p.beansInCabinet
          }));
        } else {
          // If draw or no team, select general survivor
          const maxRemainingBeans = Math.max(...prev.players.map(p => p.beansInCabinet));
          const mvps = prev.players.filter(p => p.beansInCabinet === maxRemainingBeans);
          mvpLeaders = mvps.map(p => ({
            name: p.name,
            team: p.team,
            beansLeft: p.beansInCabinet
          }));
        }
      }

      const next = {
        ...prev,
        redWins: nextRedWins,
        whiteWins: nextWhiteWins,
        roundHistory: updatedHistory,
        showRoundResult: true,
        winnerTeam: finalWinnerTeam,
        mvp: mvpLeaders,
        status: nextStatus
      };
      
      broadcastMqttState(next);
      return next;
    });
  };

  const handleNextRoundStart = () => {
    setGameState(prev => {
      // Reset players voting states for new round, reducing their spent cabinet beans
      const nextPlayers = prev.players.map(p => ({
        ...p,
        submittedThisRound: false,
        submittedBeansThisRound: 0
      }));

      const next = {
        ...prev,
        currentRound: prev.currentRound + 1,
        timeLeft: prev.timeLimit,
        timerActive: false,
        showRoundResult: false,
        status: GameStatus.PLAYING,
        players: nextPlayers
      };

      broadcastMqttState(next);
      return next;
    });
  };

  const handleRestartFullGame = () => {
    if (!window.confirm('게임을 정말 처음부터 완전히 다시 시작하겠습니다?')) return;
    
    setGameState(prev => {
      const restartedPlayers = prev.players.map(p => ({
        ...p,
        beansInCabinet: 10,
        submittedThisRound: false,
        submittedBeansThisRound: 0
      }));

      const restarted: GameState = {
        ...prev,
        status: GameStatus.PLAYING,
        currentRound: 1,
        timeLeft: prev.timeLimit,
        timerActive: false,
        redWins: 0,
        whiteWins: 0,
        roundHistory: [],
        showRoundResult: false,
        winnerTeam: null,
        mvp: null,
        players: restartedPlayers,
        revealMvp: false
      };

      broadcastMqttState(restarted);
      return restarted;
    });
  };

  // Change individual input text array manually
  const handleAddNewPlayerOption = (name: string) => {
    if (!name.trim()) return;
    setGameState(prev => {
      const brandNew: Player = {
        id: `player_${prev.players.length + 1}_${Date.now()}`,
        name: name.trim(),
        team: prev.players.length % 2 === 0 ? 'RED' : 'WHITE',
        password: generatePassword(),
        beansInCabinet: 10,
        submittedThisRound: false,
        submittedBeansThisRound: 0
      };
      const next = { ...prev, players: [...prev.players, brandNew] };
      broadcastMqttState(next);
      return next;
    });
  };

  // -------------------------------------------------------------
  // RENDER INTERACTION PANELS
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen text-slate-800 flex flex-col antialiased">
      {/* ⚠️ 실시간 연결 장애 경고 배너 */}
      {syncError && (
        <div className="bg-rose-600 text-white px-6 py-3.5 text-center text-xs font-bold flex items-center justify-center space-x-2 sticky top-0 z-[60] print:hidden">
          <span className="text-sm">⚠️</span>
          <span>실시간 연동 연결 장애: {syncError}. 네트워크 기기 및 파이어베이스 연결을 확인해 주세요. (방 코드: {gameState.roomCode || roomCodeInput || '지정 대기'})</span>
          <button
            onClick={() => {
              setSyncError(null);
              window.location.reload();
            }}
            className="bg-white/20 hover:bg-white/30 text-white text-[11px] px-2.5 py-1 rounded transition ml-3 border-none cursor-pointer font-black"
          >
            새로고침
          </button>
        </div>
      )}

      {/* 🟢 TOP NETWORK STATUS BAR */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shadow-xs sticky top-0 z-50 print:hidden">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 flex items-center justify-center bg-rose-500 rounded-xl text-white font-extrabold animate-bounce-subtle">
            🫘
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight text-gray-900">콩의 딜레마</h1>
            <p className="text-xs text-gray-500 font-medium">지니어스한 학급 놀이 활동:콩의 딜레마</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4 text-sm font-medium">
          {gameState.roomCode && (
            <div className="hidden sm:flex items-center space-x-2 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-mono">
              <Users className="w-4 h-4 text-slate-500" />
              <span>방 코드: <strong className="text-rose-600 font-extrabold text-base">{gameState.roomCode}</strong></span>
            </div>
          )}

          {view !== 'HOME' && (
            <button 
              onClick={() => {
                if (view === 'DISPLAY') {
                  setView('PRE_SETTING');
                } else if (view === 'STUDENT_ACTIVE_CABINET') {
                  setView('STUDENT_LOBBY');
                } else if (view === 'STUDENT_LOBBY') {
                  setView('PRE_SETTING');
                } else {
                  setView('HOME');
                }
              }}
              className="text-gray-500 hover:text-gray-800 transition p-1 hover:bg-gray-100 rounded-lg cursor-pointer border-0"
              title="이전 페이지 이동"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* 🖨️ 인쇄 전용 영역 (비밀의 방 팀원 비밀번호 인쇄 모듈 - 가위 자르기식 전용 그리드 장치) */}
      <div id="print-area" className="hidden print:block p-8 bg-white font-sans text-slate-900 w-full">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body {
              background: white !important;
              color: black !important;
            }
            #print-area {
              display: block !important;
            }
            .print-layout-container {
              display: grid !important;
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
              gap: 16px !important;
              width: 100% !important;
              border: 1px dashed #94a3b8 !important;
              background-color: white !important;
              padding: 12px !important;
            }
            .print-layout-item {
              border-right: 1px dashed #94a3b8 !important;
              border-bottom: 1px dashed #94a3b8 !important;
              padding: 12px !important;
              background: transparent !important;
              display: flex !important;
              flex-direction: column !important;
              justify-content: space-between !important;
              box-sizing: border-box !important;
              min-height: 140px !important;
            }
            /* Avoid columns overflow or page splitting bugs */
            .print-layout-item {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          }
        ` }} />

        <div className="text-center space-y-2 border-b-2 border-dashed border-slate-300 pb-4 mb-6">
          <h2 className="text-2xl font-black text-slate-800">🫘 플레이어 정보 및 비밀번호 대장</h2>
          <div className="flex justify-center gap-6 text-xs font-semibold text-slate-500">
            <span>🏫 연결 코드: <strong className="text-rose-600 font-extrabold text-sm">{gameState.roomCode || preSettingRoomCode || '임시 발급용'}</strong></span>
            <span>🛡️ 전광판 패스워드: <strong className="text-slate-800 font-bold">{gameState.masterPassword || masterPasswordSetting}</strong></span>
            <span>📅 생성 시각: {new Date().toLocaleDateString()}</span>
          </div>
        </div>

        <div className="print-layout-container grid grid-cols-2 gap-4 bg-white border border-dashed border-slate-400 p-3">
          {(tempPlayers.length > 0 ? tempPlayers : gameState.players).map((p, idx) => (
            <div 
              key={p.id} 
              className="print-layout-item border-r border-b border-dashed border-slate-400 p-4 relative bg-transparent flex flex-col justify-between"
              style={{ minHeight: '140px' }}
            >
              {/* Inner Solid Card Style Box representing individual player info */}
              <div className="border border-slate-250 p-4 rounded-xl bg-white flex flex-col justify-between text-center space-y-2.5 relative overflow-hidden h-full shadow-xs">
                <span className="absolute top-1 right-2 text-[8px] text-slate-400 select-none">✂️ 자르는 선</span>
                <div className="text-[10px] text-slate-400 font-mono font-bold text-left">No. {idx + 1}</div>
                
                <div className="font-display font-black text-sm text-slate-850 leading-none">
                  {p.name}
                </div>
                
                <div>
                  <span className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-black select-none ${
                    p.team === 'RED' 
                      ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                      : p.team === 'WHITE' 
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' 
                        : 'bg-slate-100 text-slate-500'
                  }`}>
                    {p.team === 'RED' ? '🔴 RED' : p.team === 'WHITE' ? '⚪ WHITE' : '미정'}
                  </span>
                </div>
                
                <div className="bg-yellow-50 border border-yellow-200 py-1.5 px-0.5 rounded-lg font-mono">
                  <span className="block text-[8px] font-extrabold text-amber-500 uppercase tracking-wider leading-none mb-1 select-none">비밀번호</span>
                  <span className="font-black text-rose-600 text-sm tracking-widest">{p.password}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center pt-6 border-t border-dashed border-slate-300 mt-6 select-none">
          <p className="text-xs text-rose-600 font-black">
            플레이어 정보 및 비밀번호를 출력 후 잘라 학생들에게 나눠주세요.
          </p>
          <p className="text-[10px] text-slate-400 leading-relaxed font-semibold mt-1">
            ⓒ 2026. Kwon's class. All rights reserved.
          </p>
        </div>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col justify-center print:hidden">
        
        {/* =============================================================
            1. [HOME VIEW]
            ============================================================= */}
        {view === 'HOME' && (
          <div className="max-w-xl w-full mx-auto my-12 text-center">
            {/* BIG DECORATIVE TITLE CARD */}
            <div className="bg-white rounded-3xl p-8 shadow-xl border border-gray-150 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-3 bg-linear-to-r from-red-500 via-neutral-100 to-blue-500" />
              
              <div className="flex justify-center mb-6">
                <span className="text-8xl select-none" role="img" aria-label="beans">🫘</span>
              </div>
              
              <div className="inline-block bg-rose-50 text-rose-600 rounded-full px-4 py-1 text-xs font-extrabold mb-3 tracking-wider">
                THE GENIUS CLASS
              </div>
              
              <h2 className="font-display font-black text-4xl sm:text-5xl text-gray-900 leading-tight tracking-tight">
                콩의 딜레마
              </h2>
              
              <p className="mt-4 text-slate-500 text-sm sm:text-base leading-relaxed px-2 font-medium">
                개인의 이익과 공동의 승리 사이에서 고민하게 되는 콩의 딜레마!<br />
                고도의 심리전과 전략 게임을 시작해보세요!
              </p>

              {/* ACTION TOGGLE OPTIONS */}
              <div className="mt-8 space-y-6">
                {lobbyError && (
                  <div className="p-3 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 text-xs text-left font-semibold flex items-center space-x-1.5 justify-center">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
                    <span>{lobbyError}</span>
                  </div>
                )}

                {/* 2. GAME INITIATION CHANNELS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setShowGameStartModal(true);
                    }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-2xl py-4 px-6 font-bold text-sm transition-all cursor-pointer flex flex-col items-center justify-center space-y-1 shadow-xs border-0 animate-fade-in"
                  >
                    <span className="font-extrabold text-sm text-slate-900">🎮 게임 시작</span>
                    <span className="text-[10px] text-slate-500 font-medium">(개설 및 기존방 이어하기)</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowDisplayConnectModal(true);
                      setLobbyError('');
                    }}
                    className="bg-rose-500 hover:bg-rose-600 text-white rounded-2xl py-4 px-6 font-bold text-sm tracking-wide transition-all flex flex-col items-center justify-center space-y-1 cursor-pointer shadow-md border-0 animate-fade-in"
                  >
                    <span className="font-black text-sm text-white flex items-center space-x-1 justify-center">
                      <Play className="w-4 h-4 fill-white shrink-0" />
                      <span>📺 게임 전광판 가동</span>
                    </span>
                    <span className="text-[10px] text-rose-100 font-semibold">(학생 공개 화면)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* QUICK RULES TOGGLE BUTTON */}
            <button 
              onClick={() => { setShowGuide(true); setGuideSlide(0); }}
              className="mt-8 inline-flex items-center space-x-2 bg-white hover:bg-slate-100 text-slate-700 font-extrabold px-6 py-3.5 rounded-2xl text-xs transition duration-150 shadow-xs cursor-pointer border border-slate-200"
            >
              <BookOpen className="w-4 h-4 text-rose-500" />
              <span>콩의 딜레마 사용설명서</span>
            </button>
          </div>
        )}

        {/* =============================================================
            2. [PRE-SETTING VIEW] (교사 사전 설정 창)
            ============================================================= */}
        {view === 'PRE_SETTING' && (
          <div className="max-w-3xl w-full mx-auto my-6 bg-white rounded-3xl p-8 shadow-xl border border-gray-100">
            <div className="flex items-center justify-between border-b border-gray-150 pb-5 mb-5">
              <div>
                <h3 className="font-display font-extrabold text-2xl text-slate-950 flex items-center">
                  🛠️ 게임 사전 설정 페이지
                </h3>
                <p className="text-xs text-gray-400 font-medium font-sans">학생 목록을 편하게 지정하고 비밀번호 대장을 출력하세요.</p>
              </div>
              <button 
                onClick={() => setShowGuide(true)}
                className="bg-rose-50 text-rose-600 hover:bg-rose-100 px-4 py-2 rounded-xl text-xs font-bold leading-none flex items-center space-x-1 transition cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>사용 설명서 팝업</span>
              </button>
            </div>

            {/* 기본 게임 설정 제시 영역 (Requirement 7) */}
            <div className="bg-rose-50/60 rounded-2xl p-5 border border-rose-100/80 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <h4 className="font-bold text-sm text-rose-800 flex items-center">
                  <span className="mr-1.5">🫘</span> 기본 게임 규칙 및 구성
                </h4>
                <div className="text-xs text-slate-500 font-medium space-x-2 flex flex-wrap">
                  <span className="bg-white/80 px-2 py-1 rounded-md border border-rose-100 font-semibold text-rose-700">✓ 5라운드 진행</span>
                  <span className="bg-white/80 px-2 py-1 rounded-md border border-rose-100 font-semibold text-rose-700">✓ 화이트/레드 팀 매치</span>
                </div>
              </div>
              
              <div className="bg-white px-4 py-3 rounded-xl border border-rose-150 flex items-center justify-between gap-3 shadow-xs">
                <span className="text-xs font-bold text-slate-705">라운드 당 타이머 설정:</span>
                <div className="flex items-center space-x-2">
                  <input 
                    type="number" 
                    min={1} 
                    max={10} 
                    value={timerMinutesSetting}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setTimerMinutesSetting(Math.max(1, Math.min(10, val)));
                    }}
                    className="w-14 bg-slate-50 border border-slate-200 rounded-lg text-center font-bold text-sm py-1 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                  <span className="text-xs font-bold text-slate-600">분</span>
                  <div className="flex items-center space-x-0.5 border border-slate-200 rounded-lg px-1 bg-slate-50">
                    <button 
                      onClick={() => setTimerMinutesSetting(prev => Math.max(1, prev - 1))}
                      className="text-slate-500 hover:text-slate-805 px-1 py-0.5 font-bold text-xs cursor-pointer select-none border-none bg-transparent"
                      title="1분 감소"
                    >
                      ▼
                    </button>
                    <div className="text-slate-300">|</div>
                    <button 
                      onClick={() => setTimerMinutesSetting(prev => Math.min(10, prev + 1))}
                      className="text-slate-500 hover:text-slate-805 px-1 py-0.5 font-bold text-xs cursor-pointer select-none border-none bg-transparent"
                      title="1분 증가"
                    >
                      ▲
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* PLAYERS LIST RAW TEXTAREA */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  플레이어 일괄 생성
                </label>
                <textarea 
                  rows={5}
                  value={playersText}
                  onChange={(e) => {
                    setPlayersText(e.target.value);
                    setHasAllocatedTeams(false); // Reset team allocation view state on edit
                  }}
                  placeholder="예시)&#10;홍진호&#10;임요환&#10;이상민&#10;이두희"
                  className="w-full bg-white border border-slate-200 rounded-xl p-3 font-medium text-base focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <p className="text-xs text-slate-400 mt-1 font-semibold">※ 학생들의 이름을 줄 간격 기준으로 일괄 작성하십시오. 수정 시 팀 배정을 다시 진행해야 합니다.</p>
              </div>

              {/* TEAM ALLOCATION MODE & MASTER PASSWORD */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <label className="block text-sm font-bold text-slate-705 mb-3">
                    화이트/레드 팀 배정 방식 선택
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setTeamAllocationMode('AUTO');
                        setHasAllocatedTeams(false);
                      }}
                      className={`py-3 px-4 rounded-xl text-xs font-extrabold tracking-wide transition cursor-pointer select-none border-0 ${
                        teamAllocationMode === 'AUTO'
                          ? 'bg-rose-500 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      자동 배정(랜덤)
                    </button>
                    <button
                      onClick={() => {
                        setTeamAllocationMode('MANUAL');
                        setHasAllocatedTeams(false);
                      }}
                      className={`py-3 px-4 rounded-xl text-xs font-extrabold tracking-wide transition cursor-pointer select-none border-0 ${
                        teamAllocationMode === 'MANUAL'
                          ? 'bg-rose-500 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      교사 수동 배정
                    </button>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <label className="block text-sm font-bold text-slate-705 mb-2">
                    게임 전광판 연동 패스워드
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={masterPasswordSetting}
                    onChange={(e) => setMasterPasswordSetting(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-center text-lg focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono"
                    placeholder="교사용 패스워드 (예: 1234)"
                  />
                  <p className="text-xs text-slate-400 mt-1">게임 전광판과 연결할 때 필요한 패스워드입니다.</p>
                </div>
              </div>
            </div>

              {/* 팀 배정 목록 결과 (Requirement 8) */}
              {hasAllocatedTeams && (
                <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50 space-y-4 text-left">
                  <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 flex-wrap gap-2">
                    <div>
                      <h4 className="font-bold text-base text-slate-800">팀 배정</h4>
                      <p className="text-xs text-slate-500 font-medium leading-relaxed">
                        {teamAllocationMode === 'AUTO' 
                          ? '랜덤하게 배정된 각 팀이 활성화되었습니다. 학생 이름을 누르거나 단추를 눌러 개별 수동 변경 가능합니다.' 
                          : '수동 배정이 선택되었습니다. 아래 목록에서 각 학생 이름 우측의 [화이트] 또는 [레드] 팀을 직접 배정하십시오.'
                        }
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto pr-1">
                    {tempPlayers.map((player) => {
                      return (
                        <div key={player.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-150 shadow-xs text-sm">
                          {/* Clickable player name tags toggles team */}
                          <button
                            onClick={() => {
                              const updated = tempPlayers.map(p => {
                                if (p.id === player.id) {
                                  const nextTeam = p.team === 'RED' ? 'WHITE' : 'RED';
                                  return { ...p, team: nextTeam };
                                }
                                return p;
                              });
                              setTempPlayers(updated);
                            }}
                            className="font-bold text-slate-800 hover:text-rose-500 transition focus:outline-none flex items-center space-x-1.5 text-left border-0 bg-transparent cursor-pointer"
                            title="클릭하여 팀을 바꿉니다"
                          >
                            <span>👤 {player.name}</span>
                          </button>

                          <div className="flex items-center space-x-2">
                            {/* Team togglers */}
                            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                              <button
                                onClick={() => {
                                  const updated = tempPlayers.map(p => {
                                    if (p.id === player.id) return { ...p, team: 'WHITE' };
                                    return p;
                                  });
                                  setTempPlayers(updated);
                                }}
                                className={`text-xs px-2.5 py-1 rounded-md font-extrabold transition cursor-pointer border-0 ${
                                  player.team === 'WHITE'
                                    ? 'bg-white text-indigo-700 shadow-md border border-slate-200/50'
                                    : 'text-slate-400 hover:text-slate-600 bg-transparent'
                                }`}
                              >
                                화이트
                              </button>
                              <button
                                onClick={() => {
                                  const updated = tempPlayers.map(p => {
                                    if (p.id === player.id) return { ...p, team: 'RED' };
                                    return p;
                                  });
                                  setTempPlayers(updated);
                                }}
                                className={`text-xs px-2.5 py-1 rounded-md font-extrabold transition cursor-pointer border-0 ${
                                  player.team === 'RED'
                                    ? 'bg-rose-500 text-white shadow-md'
                                    : 'text-slate-400 hover:text-slate-600 bg-transparent'
                                }`}
                              >
                                레드
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 팀 배정 하단 안내 메시지 */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 flex items-center space-x-2.5 text-indigo-950 font-bold text-xs sm:text-sm shadow-xs">
                    <Sparkles className="w-5 h-5 text-indigo-600 shrink-0" />
                    <span>게임 시작을 누르면 학생들에게 배정된 팀 명단이 공개됩니다. 게임 전광판 화면을 켜서 학생들에게 보여주세요.</span>
                  </div>
                </div>
              )}

              {/* ACTION COMMAND CENTER */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                {/* 1단계. 팀 배정 시작 버튼 (Requirement 8) - 사라짐 조건 (Requirement 11) */}
                {!hasAllocatedTeams && (
                  <button
                    onClick={handleStartTeamAllocation}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm px-6 py-4 rounded-2xl shadow-md cursor-pointer transition duration-150 flex items-center justify-center space-x-2 border-none"
                  >
                    <Users className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <span>팀 배정 시작</span>
                  </button>
                )}

                {/* 2단계. 이전으로, 게임시작 버튼 */}
                <div className="flex flex-col sm:flex-row gap-3 font-sans">
                  <button
                    onClick={() => {
                      setView('HOME');
                      setHasAllocatedTeams(false);
                    }}
                    className="bg-slate-100 text-slate-705 font-extrabold text-sm px-6 py-4 rounded-2xl hover:bg-slate-200 transition duration-150 order-2 sm:order-1 flex items-center justify-center space-x-2 cursor-pointer border-none"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>이전으로</span>
                  </button>
                  <button
                    onClick={setupPlayers}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm px-6 py-4 rounded-2xl shadow-md cursor-pointer transition duration-150 order-1 sm:order-2 flex items-center justify-center space-x-2 border-none"
                  >
                    <Sparkles className="w-4 h-4 text-yellow-300" />
                    <span>게임 시작</span>
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* =============================================================
            3. [STUDENT LOBBY VIEW - SECRET CABINET ROOM]
            ============================================================= */}
        {view === 'STUDENT_LOBBY' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-md border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="bg-red-50 text-red-600 font-extrabold px-3 py-1 rounded-full text-xs uppercase tracking-wide">
                  비밀의 방 (태블릿 화면)
                </span>
                <h3 className="font-display font-black text-2xl sm:text-3xl text-gray-900 mt-2">
                  🤫 사물함
                </h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  자신의 이름을 선택하여 사물함을 여세요.<br/>
                  사물함은 오직 본인에게만 보이므로 투표 개수는 철저히 비밀이 보증됩니다.
                </p>
              </div>
              
              {/* PRINT & HELP CONTROLS FOR STUDENTS/TEACHERS */}
              <div className="flex flex-col sm:flex-row items-center gap-4">
                {/* 실시간 타이머 시큐어 연동판 */}
                <div className={`p-4 rounded-2xl border flex flex-col items-center justify-center min-w-[180px] text-center transition-all ${
                  gameState.status === GameStatus.ROUND_ENDED
                    ? 'bg-red-50/10 border-red-500 shadow-sm'
                    : gameState.timerActive 
                    ? 'bg-rose-50 border-rose-200 shadow-sm' 
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-center space-x-1.5 text-slate-500 text-[10px] font-black uppercase tracking-wider">
                    <Timer className={`w-3.5 h-3.5 ${gameState.timerActive ? 'text-rose-500 animate-spin' : 'text-slate-400'}`} />
                    <span>비밀 투표 마감 타이머</span>
                  </div>
                  <div className="font-display text-2xl font-black text-slate-950 font-mono tracking-widest mt-0.5">
                    {Math.floor(gameState.timeLeft / 60)}:{String(gameState.timeLeft % 60).padStart(2, '0')}
                  </div>
                  <span className={`text-[9px] font-black mt-1 px-2 py-0.5 rounded-full select-none ${
                    gameState.status === GameStatus.ROUND_ENDED
                      ? 'bg-red-600 text-white'
                      : gameState.timerActive 
                      ? 'bg-rose-600 text-white animate-pulse' 
                      : 'bg-slate-200 text-slate-700'
                  }`}>
                    {gameState.status === GameStatus.ROUND_ENDED ? '투표 종료됨' : gameState.timerActive ? '실시간 타이머 작동 중' : '교사 가동 대기 중'}
                  </span>
                </div>

                {/* Manual state update override */}
                <button
                  onClick={() => {
                    if (window.confirm('게임을 새로 시작하시겠습니까?')) {
                      if (syncBridgeRef.current) {
                        syncBridgeRef.current.destroy();
                        syncBridgeRef.current = null;
                      }
                      setMqttConnected(false);
                      setGameState(createInitialState('', ''));
                      setRole(null);
                      setView('HOME');
                    }
                  }}
                  className="bg-slate-100 text-slate-700 hover:bg-slate-200 p-3.5 rounded-2xl text-xs font-bold transition h-fit cursor-pointer border-0"
                  title="게임 새로 시작 및 종료"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {gameState.players.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-3xl shadow-sm border border-slate-150">
                <p className="text-slate-400 font-bold mb-4">현재 배정된 플레이어가 없습니다.</p>
                <button
                  onClick={() => setView('PRE_SETTING')}
                  className="bg-rose-500 text-white rounded-xl py-3 px-6 font-bold text-sm hover:bg-rose-600 transition"
                >
                  교사용 사전 설정실 진입
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10">
                {/* WHITE TEAM (Left) */}
                <div className="bg-slate-50/40 border border-slate-200 rounded-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-2">
                    <span className="text-sm font-black text-slate-700 flex items-center space-x-1.5 select-none">
                      <span>⚪ WHITE TEAM</span>
                      <span className="bg-slate-200/70 text-slate-700 text-xs px-2.5 py-0.5 rounded-full font-extrabold">
                        {gameState.players.filter(p => p.team === 'WHITE').length}명
                      </span>
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    {gameState.players.filter(p => p.team === 'WHITE').map((p) => {
                      const isSubmitted = p.submittedThisRound;
                      return (
                        <div
                          key={p.id}
                          onClick={() => !isSubmitted && attemptOpenCabinet(p)}
                          className={`relative bg-white rounded-2xl p-4 border-2 transition-all cursor-pointer select-none group text-center flex flex-col justify-between min-h-[140px] ${
                            isSubmitted 
                              ? 'border-gray-200 opacity-60 bg-gray-50' 
                              : 'border-slate-300 hover:border-slate-500 shadow-xs hover:shadow-md'
                          }`}
                        >
                          <div className="text-3xl my-2 text-center group-hover:scale-110 transition">
                            {isSubmitted ? '🔒' : '🗄️'}
                          </div>

                          <h4 className="font-sans font-black text-sm text-slate-800 truncate">{p.name}</h4>
                          
                          <div className="mt-2">
                            {isSubmitted ? (
                              <span className="inline-flex items-center bg-gray-100 text-gray-500 font-extrabold text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200">
                                <span>봉인</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center bg-emerald-50 text-emerald-800 font-extrabold text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-105">
                                <span>대기</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* RED TEAM (Right) */}
                <div className="bg-red-50/20 border border-red-100 rounded-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-red-200 pb-3 mb-2">
                    <span className="text-sm font-black text-rose-700 flex items-center space-x-1.5 select-none font-bold">
                      <span>🔴 RED TEAM</span>
                      <span className="bg-rose-100 text-rose-700 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                        {gameState.players.filter(p => p.team === 'RED').length}명
                      </span>
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    {gameState.players.filter(p => p.team === 'RED').map((p) => {
                      const isSubmitted = p.submittedThisRound;
                      return (
                        <div
                          key={p.id}
                          onClick={() => !isSubmitted && attemptOpenCabinet(p)}
                          className={`relative bg-white rounded-2xl p-4 border-2 transition-all cursor-pointer select-none group text-center flex flex-col justify-between min-h-[140px] ${
                            isSubmitted 
                              ? 'border-gray-200 opacity-60 bg-gray-50' 
                              : 'border-red-300 hover:border-red-500 shadow-xs hover:shadow-md'
                          }`}
                        >
                          <div className="text-3xl my-2 text-center group-hover:scale-110 transition">
                            {isSubmitted ? '🔒' : '🗄️'}
                          </div>

                          <h4 className="font-sans font-black text-sm text-slate-800 truncate">{p.name}</h4>
                          
                          <div className="mt-2">
                            {isSubmitted ? (
                              <span className="inline-flex items-center bg-gray-100 text-gray-500 font-extrabold text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200">
                                <span>봉인</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center bg-emerald-50 text-emerald-800 font-extrabold text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-110">
                                <span>대기</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            
            {/* SPLIT NAVIGATION CONTROL HELPER (전광판 이동 & 태블릿 비밀의 방 QR) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sans pt-2">
              
              {/* CARD 1: 메인화면 - 게임 전광판으로 이동 */}
              <div className="p-6 sm:p-7 bg-indigo-50 rounded-[32px] border-4 border-indigo-600 shadow-lg flex flex-col justify-between space-y-4 text-left">
                <div className="space-y-2">
                  <h5 className="text-xl font-black text-indigo-950 flex items-center space-x-2">
                    <Tv className="w-6 h-6 text-indigo-600 shrink-0" />
                    <span>📺 메인화면 - 게임 전광판으로 이동</span>
                  </h5>
                  <p className="text-xs sm:text-sm text-slate-700 font-bold leading-relaxed">
                    아래 버튼을 클릭해서 메인 화면으로 이동해 주세요. 메인 화면에서 '게임 전광판' 페이지로 이동해 주세요. 게임 전광판 화면은 학생들이 잘 볼 수 있게 TV로 보여주시면 됩니다.
                  </p>
                </div>
                
                <button
                  onClick={() => {
                    setShowTempDisplayAlert(true);
                  }}
                  className="w-full bg-indigo-600 text-white hover:bg-indigo-700 py-4 px-6 rounded-2xl text-sm sm:text-base font-black flex items-center justify-center space-x-2 transition border-0 cursor-pointer shadow-md hover:shadow-lg transform active:scale-95 duration-150"
                >
                  <Shield className="w-5 h-5 text-yellow-300" />
                  <span>메인화면-게임 전광판으로 이동</span>
                </button>
              </div>

              {/* CARD 2: 태블릿 - 비밀의 방 열기 (QR 연동) */}
              {(() => {
                const secretRoomUrl = `${window.location.origin}${window.location.pathname}?room=${gameState.roomCode || '1234'}&mode=secret_room`;
                return (
                  <div className="p-6 sm:p-7 bg-rose-50 rounded-[32px] border-4 border-rose-500 shadow-lg flex flex-col justify-between space-y-4 text-left">
                    <div className="space-y-2">
                      <h5 className="text-xl font-black text-rose-950 flex items-center space-x-2">
                        <Tablet className="w-6 h-6 text-rose-600 shrink-0" />
                        <span>📱 태블릿 - 비밀의 방 열기</span>
                      </h5>
                      <p className="text-xs sm:text-sm text-slate-700 font-bold leading-relaxed">
                        복도나 별도의 공간에 비밀의 방을 만들어주세요. 비밀의 방에 태블릿을 놓고 태블릿으로 콩을 배팅하게 해주세요. 옆에 QR코드를 인식하면 태블릿에서 비밀의 방 페이지를 열 수 있습니다.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-3.5 rounded-2xl border border-rose-200">
                      <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-xs shrink-0 flex flex-col items-center">
                        <QRCodeSVG value={secretRoomUrl} size={92} level="M" />
                        <span className="text-[10px] font-black text-slate-500 mt-1 flex items-center space-x-1">
                          <QrCode className="w-3 h-3 text-rose-500" />
                          <span>QR 스캔</span>
                        </span>
                      </div>

                      <div className="flex-1 space-y-2 text-center sm:text-left w-full">
                        <div className="text-xs font-bold text-slate-600">
                          연동 코드: <strong className="text-rose-600 text-sm font-mono select-all">{gameState.roomCode}</strong>
                        </div>
                        <button
                          onClick={() => {
                            setView('STUDENT_LOBBY');
                          }}
                          className="w-full bg-rose-500 hover:bg-rose-600 text-white py-3 px-4 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center space-x-1.5 transition border-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          <Tablet className="w-4 h-4 text-rose-200" />
                          <span>태블릿 - 비밀의 방 열기</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>
        )}

        {/* =============================================================
            4. [STUDENT VIEW - ACTIVE SECRET CABINET INTERACTION]
            ============================================================= */}
        {view === 'STUDENT_ACTIVE_CABINET' && (
          (() => {
            const activePlayer = gameState.players.find(p => p.id === authPlayerId);
            if (!activePlayer) return null;
            
            return (
              <div className="max-w-2xl w-full mx-auto my-6 bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-rose-100 text-center relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-full h-3 ${activePlayer.team === 'RED' ? 'bg-red-500' : 'bg-gray-400'}`} />
                
                <div className="flex items-center justify-between border-b border-gray-100 pb-5 mb-6">
                  <div className="flex items-center space-x-2">
                    <span className="text-3xl">🏺</span>
                    <div className="text-left">
                      <h4 className="font-display font-black text-xl text-slate-900">{activePlayer.name} 학생의 비밀 사물함</h4>
                      <p className="text-xs text-slate-500">소속: <span className={activePlayer.team === 'RED' ? 'text-red-500 font-bold' : 'text-slate-600 font-bold'}>{activePlayer.team === 'RED' ? '레드 팀' : '화이트 팀'}</span></p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end space-y-1.5 font-sans">
                    <span className="bg-slate-100 text-slate-707 px-3 py-1 rounded-lg text-xs font-bold leading-none">
                      현재 {gameState.currentRound}라운드 제출 차례
                    </span>
                    <span className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-black border tracking-wider ${
                      gameState.timerActive 
                        ? 'bg-rose-500 text-white border-rose-400 animate-pulse' 
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      <Timer className={`w-3.5 h-3.5 ${gameState.timerActive ? 'animate-spin' : ''}`} />
                      <span>{Math.floor(gameState.timeLeft / 60)}:{String(gameState.timeLeft % 60).padStart(2, '0')}</span>
                    </span>
                  </div>
                </div>

                <div className="py-8 grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-radial from-slate-50 to-white rounded-2xl border border-slate-100">
                  
                  {/* CABINET RETENTION BEANS */}
                  <div className="space-y-4">
                    <h5 className="font-extrabold text-sm uppercase text-slate-500 tracking-wider">📦 사물함에 있는 콩</h5>
                    
                    <div className="min-h-32 w-full flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-dashed border-slate-200">
                      <div className="flex flex-wrap gap-2 justify-center items-center py-2 max-w-full">
                        {Array.from({ length: cabinetBeansLeft }).map((_, i) => (
                          <span 
                            key={i} 
                            onClick={() => {
                              if (cabinetBeansLeft > 0) {
                                setCabinetBeansLeft(prev => prev - 1);
                                setCabinetBeansSubmitted(prev => prev + 1);
                              }
                            }}
                            className="inline-block hover:scale-125 transition cursor-pointer select-none"
                            title="호리병 투표함에 넣기"
                          >
                            <SingleBeanIcon className="w-10 h-10" />
                          </span>
                        ))}
                        {cabinetBeansLeft === 0 && <span className="text-xs text-slate-300 font-bold">(남은 콩 없음)</span>}
                      </div>
                      <p className="mt-3 text-lg font-black text-slate-800">
                        사물함에 남은 콩: <span className="text-amber-600 text-2xl">{cabinetBeansLeft}</span>개
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">사물함의 콩을 터치하면 호리병(🏺) 투표함으로 쏙 밀려 들어갑니다.</p>
                  </div>

                  {/* VOTE BOTTLE BEANS SUBMITTING */}
                  <div className="space-y-4">
                    <h5 className="font-extrabold text-sm uppercase text-slate-500 tracking-wider">🏺 호리병 투표함 (이번 낼 개수)</h5>
                    
                    <div className="min-h-32 w-full flex flex-col items-center justify-center p-4 bg-rose-50/50 rounded-2xl border border-rose-100">
                      <div className="flex flex-wrap gap-2 justify-center items-center py-2 max-w-full">
                        {Array.from({ length: cabinetBeansSubmitted }).map((_, i) => (
                          <span 
                            key={i} 
                            onClick={() => {
                              if (cabinetBeansSubmitted > 0) {
                                setCabinetBeansSubmitted(prev => prev - 1);
                                setCabinetBeansLeft(prev => prev + 1);
                              }
                            }}
                            className="inline-block hover:scale-125 transition cursor-pointer select-none"
                            title="지우고 사물함에 되돌려놓기"
                          >
                            <SingleBeanIcon className="w-10 h-10" />
                          </span>
                        ))}
                        {cabinetBeansSubmitted === 0 && <span className="text-xs text-slate-300 font-bold">(0개 투표 대기중)</span>}
                      </div>
                      <p className="mt-3 text-lg font-black text-rose-700">
                        투표 제출 콩: <span className="text-rose-600 text-3xl">{cabinetBeansSubmitted}</span>개
                      </p>
                    </div>
                    <p className="text-xs text-rose-500">호리병 안의 콩을 역으로 누르면 다시 사물함 금고로 안전하게 복귀됩니다.</p>
                  </div>

                </div>

                {/* COMPACT HELPER BUTTONS */}
                <div className="flex justify-center space-x-2 mt-6">
                  <button 
                    onClick={() => {
                      if (cabinetBeansLeft > 0) {
                        setCabinetBeansSubmitted(prev => prev + cabinetBeansLeft);
                        setCabinetBeansLeft(0);
                      }
                    }}
                    className="bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs px-3 py-2 rounded-lg font-bold shadow-xs cursor-pointer"
                  >
                    전부 다 호리병에 넣기
                  </button>
                  <button 
                    onClick={() => {
                      if (cabinetBeansSubmitted > 0) {
                        setCabinetBeansLeft(prev => prev + cabinetBeansSubmitted);
                        setCabinetBeansSubmitted(0);
                      }
                    }}
                    className="bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs px-3 py-2 rounded-lg font-bold shadow-xs cursor-pointer"
                  >
                    전부 빼고 초기화
                  </button>
                </div>

                {/* GRAND CONFIRM ACTIONS */}
                <div className="mt-8 pt-6 border-t border-gray-150 flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => {
                      setView('STUDENT_LOBBY');
                      setAuthPlayerId(null);
                    }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-6 py-3.5 rounded-xl text-sm transition cursor-pointer"
                  >
                    닫기
                  </button>
                  <button
                    onClick={submitCabinetChoice}
                    className="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-extrabold px-6 py-3.5 rounded-xl shadow-md transition duration-150 text-sm flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>콩 제출 완료 🔒</span>
                  </button>
                </div>
              </div>
            );
          })()
        )}

        {/* =============================================================
            5. [DISPLAY VIEW - MAIN HOST BOARD]
            ============================================================= */}
        {view === 'DISPLAY' && gameState.status !== GameStatus.GAME_OVER && (
          <div className="space-y-6">
            
            {/* BROADCAST TOP CONTROL CENTER */}
            <div className="bg-white rounded-[36px] p-8 sm:p-10 shadow-2xl border-4 border-slate-900 grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 items-center">
              
              {/* ROUND INFO DISPLAY */}
              <div className="text-center lg:text-left space-y-2">
                <h3 className="font-display font-black text-4xl sm:text-5xl text-slate-900 tracking-tight">
                  ROUND <span className="font-black text-indigo-600">{gameState.currentRound}</span> / {gameState.totalRounds}
                </h3>
                <div className="flex justify-center lg:justify-start items-center space-x-2 text-sm font-black text-slate-600">
                  <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-xl">레드: {gameState.redWins}승</span>
                  <span className="bg-indigo-150 text-indigo-700 bg-slate-100 px-3 py-1 rounded-xl">화이트: {gameState.whiteWins}승</span>
                  <span className="text-gray-300">|</span>
                  <span>5전 3선승제</span>
                </div>
              </div>

              {/* HIGH SCANNABLE TIMER COMPONENT */}
              <div className={`bg-slate-50 border-4 rounded-[28px] p-5 flex flex-col items-center justify-center shadow-md transition-colors duration-300 ${
                gameState.status === GameStatus.ROUND_ENDED 
                  ? 'border-red-500 bg-red-50/20 shadow-red-100/50' 
                  : 'border-slate-900'
              }`}>
                <div className="flex items-center space-x-1.5 text-slate-500 text-sm font-black uppercase mb-1">
                  <Timer className="w-5 h-5 text-rose-600 animate-pulse" />
                  <span>비밀 투표 마감 타이머</span>
                </div>
                
                <div className="font-display text-6xl sm:text-[5.5rem] font-black text-slate-950 font-mono tracking-widest leading-none my-2">
                  {gameState.status === GameStatus.ROUND_ENDED 
                    ? '0:00' 
                    : `${Math.floor(gameState.timeLeft / 60)}:${String(gameState.timeLeft % 60).padStart(2, '0')}`}
                </div>

                <div className="flex space-x-1.5 mt-2.5">
                  <button
                    onClick={handleToggleTimer}
                    className={`text-xs font-black px-4 py-2 rounded-xl transition ${
                      gameState.timerActive 
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    {gameState.timerActive ? '일시 정지' : '타이머 가동'}
                  </button>
                  <button
                    onClick={handleResetTimer}
                    className="bg-slate-200 text-slate-700 hover:bg-slate-300 text-xs font-black px-4 py-2 rounded-xl"
                  >
                    리셋
                  </button>
                  <button
                    onClick={handleImmediateRoundEnd}
                    className="bg-red-50 text-red-600 hover:bg-red-100 text-xs font-black px-4 py-2 rounded-xl border border-red-200"
                  >
                    투표 즉시 종료
                  </button>
                </div>
              </div>

              {/* ROOM CODE & EXPLANATION TO STUDENTS */}
              <div className="text-center lg:text-right bg-rose-50 p-6 rounded-[28px] border-4 border-rose-500 shadow-sm">
                <h5 className="text-xs sm:text-sm font-black uppercase text-rose-900 tracking-wider">📱 학생 단말기 실시간 연동 코드</h5>
                <h4 className="font-display font-black text-5xl sm:text-6xl text-rose-600 tracking-widest animate-pulse mt-2 font-mono">
                  {gameState.roomCode}
                </h4>
              </div>

            </div>

            {/* PRESENT SCANNABLE REALTIME VOTING LIST (RED TEAM VS WHITE TEAM) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* RED TEAM MODULE */}
              <div className="bg-white rounded-3xl shadow-sm border border-red-10 border-t-8 border-t-red-500 overflow-hidden">
                <div className="bg-red-50/50 px-6 py-4 border-b border-red-100 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xl">🔴</span>
                    <h4 className="font-display font-extrabold text-lg text-red-950">RED TEAM (레드 팀 명단)</h4>
                  </div>
                  <span className="bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
                    {gameState.players.filter(p => p.team === 'RED').length}명 소속
                  </span>
                </div>

                <div className="p-6 divide-y divide-gray-50 max-h-120 overflow-y-auto">
                  {gameState.players.filter(p => p.team === 'RED').map((p) => (
                    <div key={p.id} className="py-3.5 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="text-3xl select-none">{p.submittedThisRound ? '🔒' : '🗄️'}</span>
                        <div>
                          <strong className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">{p.name}</strong>
                        </div>
                      </div>

                      <div>
                        {p.submittedThisRound ? (
                          <span className="inline-flex items-center space-x-1 bg-red-100 text-red-700 font-black text-xs px-3 py-1.5 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5 text-red-600 animate-bounce-subtle" />
                            <span>제출 완료</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 bg-gray-100 text-gray-400 font-medium text-xs px-3 py-1.5 rounded-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                            <span>제출 고민 중..</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {gameState.players.filter(p => p.team === 'RED').length === 0 && (
                    <p className="text-center py-6 text-gray-300 text-sm">레드 팀 배정원이 없습니다.</p>
                  )}
                </div>
              </div>

              {/* WHITE TEAM MODULE */}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-10 border-t-8 border-t-slate-800 overflow-hidden">
                <div className="bg-slate-100/50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xl">⚪</span>
                    <h4 className="font-display font-extrabold text-lg text-slate-900">WHITE TEAM (화이트 팀 명단)</h4>
                  </div>
                  <span className="bg-slate-200 text-slate-800 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
                    {gameState.players.filter(p => p.team === 'WHITE').length}명 소속
                  </span>
                </div>

                <div className="p-6 divide-y divide-gray-50 max-h-120 overflow-y-auto">
                  {gameState.players.filter(p => p.team === 'WHITE').map((p) => (
                    <div key={p.id} className="py-3.5 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="text-3xl select-none">{p.submittedThisRound ? '🔒' : '🗄️'}</span>
                        <div>
                          <strong className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">{p.name}</strong>
                        </div>
                      </div>

                      <div>
                        {p.submittedThisRound ? (
                          <span className="inline-flex items-center space-x-1 bg-slate-900 text-white font-black text-xs px-3 py-1.5 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 animate-bounce-subtle" />
                            <span>제출 완료</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 bg-gray-100 text-gray-400 font-medium text-xs px-3 py-1.5 rounded-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                            <span>제출 고민 중..</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {gameState.players.filter(p => p.team === 'WHITE').length === 0 && (
                    <p className="text-center py-6 text-gray-300 text-sm">화이트 팀 배정원이 없습니다.</p>
                  )}
                </div>
              </div>

            </div>

            {/* ==============================================
                ROUND ENDED / RESULT REVEAL GATEWAY
                ============================================== */}
            {gameState.status === GameStatus.ROUND_ENDED && (
              <div className="bg-rose-500/30 rounded-3xl p-6 sm:p-8 text-slate-900 border border-rose-200/50 shadow-md text-center space-y-4">
                <span className="text-5xl select-none animate-bounce-subtle inline-block">🫘</span>
                <h4 className="font-display font-black text-2xl sm:text-3xl text-rose-950">투표 마감!</h4>
                <p className="text-sm max-w-xl mx-auto text-slate-700 leading-relaxed font-semibold whitespace-pre-line">
                  라운드가 종료되었습니다. 라운드 승리팀/패배팀과 패배팀의 총 콩 투표 수만 공개됩니다.
                </p>

                {!gameState.showRoundResult ? (
                  <button
                    onClick={handleRevealRoundResult}
                    className="bg-rose-600 text-white hover:bg-rose-700 text-base font-black px-8 py-4 rounded-2xl shadow-xl transition transform active:scale-95 flex items-center justify-center space-x-2 mx-auto cursor-pointer border-none"
                  >
                    <Eye className="w-5 h-5 text-white" />
                    <span>이번 라운드 패배팀 콩 개수 전광판 오픈하기</span>
                  </button>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.93, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-800 mt-4 max-w-2xl mx-auto text-left shadow-2xl overflow-hidden relative"
                  >
                    {(() => {
                      const record = gameState.roundHistory[gameState.roundHistory.length - 1];
                      if (!record) return null;

                      return (
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <motion.div 
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
                              className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800"
                            >
                              <h6 className="text-[11px] uppercase font-bold text-slate-400">🔴 레드팀이 제출한 전체 콩 수</h6>
                              <p className="text-xl font-black text-rose-200 mt-1.5">
                                {record.winnerTeam === 'RED' ? (
                                  <span className="text-sm text-slate-500 font-bold bg-slate-800 px-2.5 py-1 rounded-lg">비공개</span>
                                ) : (
                                  <span className="inline-flex items-center space-x-1.5 bg-amber-400 text-slate-950 px-2.5 py-1 rounded-xl text-sm font-black shadow-xs">
                                    <span className="filter brightness-125">🫘</span>
                                    <span>{record.redTotalSubmitted}개</span>
                                  </span>
                                )}
                              </p>
                            </motion.div>

                            <motion.div 
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.4, duration: 0.5, ease: "easeOut" }}
                              className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800"
                            >
                              <h6 className="text-[11px] uppercase font-bold text-slate-400">⚪ 화이트팀이 제출한 전체 콩 수</h6>
                              <p className="text-xl font-black text-rose-200 mt-1.5">
                                {record.winnerTeam === 'WHITE' ? (
                                  <span className="text-sm text-slate-500 font-bold bg-slate-800 px-2.5 py-1 rounded-lg">비공개</span>
                                ) : (
                                  <span className="inline-flex items-center space-x-1.5 bg-amber-400 text-slate-950 px-2.5 py-1 rounded-xl text-sm font-black shadow-xs">
                                    <span className="filter brightness-125">🫘</span>
                                    <span>{record.whiteTotalSubmitted}개</span>
                                  </span>
                                )}
                              </p>
                            </motion.div>
                          </div>

                          <motion.div 
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.7, type: "spring", stiffness: 100, damping: 12 }}
                            className="text-center py-6 bg-slate-950/40 rounded-2xl border border-slate-800 relative overflow-hidden"
                          >
                            <h4 className="font-display font-black text-2xl sm:text-3xl text-yellow-300 px-4">
                              {record.winnerTeam === 'DRAW' 
                                ? '무승부! (양 팀 다 동일한 양의 콩을 냈습니다)' 
                                : `${record.winnerTeam === 'RED' ? '흰색(WHITE)' : '빨간색(RED)'}팀 패배: 총 ${record.defeatedTeamTotalBeans}개!`}
                            </h4>
                            <p className="text-xs text-slate-300 mt-2 px-4 leading-relaxed max-w-md mx-auto">
                              승리 팀의 공 제출 개수는 공개하지 않습니다.<br />다음 라운드의 완벽한 승리를 위한 전략을 짜보세요!
                            </p>
                          </motion.div>

                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 1.1, duration: 0.4 }}
                            className="flex justify-center"
                          >
                            <button
                              onClick={handleNextRoundStart}
                              className="bg-yellow-400 text-slate-950 hover:bg-yellow-300 text-base font-black px-8 py-3.5 rounded-xl shadow-lg transition transform active:scale-95 flex items-center justify-center space-x-2 cursor-pointer border-0 w-full sm:w-auto"
                            >
                              <span>다음 라운드 시작</span>
                              <ArrowRight className="w-5 h-5 ml-1" />
                            </button>
                          </motion.div>
                        </div>
                      );
                    })()}
                  </motion.div>
                )}
              </div>
            )}

            {/* HISTORICAL ROUND LEDGERS */}
            {gameState.roundHistory.length > 0 && (
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-150">
                <h4 className="font-display font-black text-sm text-slate-500 uppercase tracking-widest mb-4 flex items-center">
                  <Award className="w-4 h-4 text-rose-500 mr-2" />
                  라운드별 결과
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 animate-fade-in">
                  {gameState.roundHistory.map((rec) => (
                    <div key={rec.round} className="bg-slate-50 p-4 rounded-2xl border border-slate-100/80 hover:bg-slate-100 transition-colors">
                      <span className="font-mono text-[11px] text-slate-400 font-black">ROUND {rec.round} Result</span>
                      <strong className={`block text-sm font-black mt-1 ${
                        rec.winnerTeam === 'RED' ? 'text-rose-600' : rec.winnerTeam === 'WHITE' ? 'text-indigo-600' : 'text-slate-400'
                      }`}>
                        {rec.winnerTeam === 'RED' ? '🔴 RED 승리' : rec.winnerTeam === 'WHITE' ? '⚪ WHITE 승리' : '🎗️ 무승부(Draw)'}
                      </strong>
                      <p className="text-[11px] text-slate-505 font-bold mt-1">
                        패배팀 콩 제출: {rec.defeatedTeamTotalBeans}개
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FORCE RESET TO LOBBY */}
            <div className="flex justify-between items-center text-xs text-slate-500 pt-6 font-sans border-t border-slate-100 mt-6 select-none">
              <button 
                onClick={() => {
                  const confirmMsg = '콩의 딜레마 게임 세부 설정 및 모니터링을 위한 관리자 페이지가 열립니다. 학생들에게 노출되지 않도록 주의해 주세요.';
                  if (window.confirm(confirmMsg)) {
                    const url = `${window.location.origin}${window.location.pathname}?admin=true&roomCode=${gameState.roomCode}`;
                    window.open(url, '_blank');
                  }
                }}
                className="text-slate-600 hover:text-slate-900 font-extrabold flex items-center space-x-1.5 px-4 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-xl transition cursor-pointer text-sm"
              >
                <Settings className="w-4 h-4 text-slate-500" />
                <span>🔒 관리자 페이지</span>
              </button>

              <button 
                onClick={handleEndGameImmediately}
                className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center space-x-1 px-4 py-2 hover:bg-rose-50 rounded-xl transition cursor-pointer border-0 bg-transparent text-sm"
              >
                <XCircle className="w-4 h-4 text-rose-500" />
                <span>게임 종료</span>
              </button>
            </div>
          </div>
        )}

        {/* =============================================================
            6. [GAME OVER / ENDING VIEW - MULTI-STAGE REVEAL FLOW]
            ============================================================= */}
        {gameState.status === GameStatus.GAME_OVER && (
          <div className="max-w-4xl w-full mx-auto my-12 bg-white rounded-[40px] p-8 sm:p-14 shadow-2xl border-4 border-indigo-200 text-center relative overflow-hidden font-sans space-y-8 animate-fade-in">
            {/* Celebration CSS Animations */}
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes float-emoji-1 {
                0% { transform: translateY(0px) rotate(0deg) scale(1); }
                50% { transform: translateY(-20px) rotate(15deg) scale(1.15); }
                100% { transform: translateY(0px) rotate(0deg) scale(1); }
              }
              @keyframes float-emoji-2 {
                0% { transform: translateY(0px) rotate(0deg) scale(1.1); }
                50% { transform: translateY(-25px) rotate(-15deg) scale(0.95); }
                100% { transform: translateY(0px) rotate(0deg) scale(1.1); }
              }
              @keyframes rainbow-border {
                0%, 100% { border-color: #f43f5e; box-shadow: 0 0 20px rgba(244, 63, 94, 0.4); }
                33% { border-color: #eab308; box-shadow: 0 0 20px rgba(234, 179, 8, 0.4); }
                66% { border-color: #6366f1; box-shadow: 0 0 20px rgba(99, 102, 241, 0.4); }
              }
              .celebrate-element-1 { animation: float-emoji-1 5s ease-in-out infinite; }
              .celebrate-element-2 { animation: float-emoji-2 6s ease-in-out infinite; }
              .rainbow-glow { animation: rainbow-border 4s linear infinite; }
            `}} />

            {/* Background Floating Celebration Elements */}
            <div className="absolute top-10 left-10 text-5xl select-none celebrate-element-1 opacity-80 pointer-events-none">👑</div>
            <div className="absolute top-12 right-12 text-5xl select-none celebrate-element-2 opacity-80 pointer-events-none">🏆</div>
            <div className="absolute bottom-24 left-14 text-5xl select-none celebrate-element-2 opacity-80 pointer-events-none">🎉</div>
            <div className="absolute bottom-20 right-14 text-5xl select-none celebrate-element-1 opacity-80 pointer-events-none">✨</div>

            {/* STAGE 1: LAST ROUND VOTING RESULTS ONLY */}
            {(!gameState.gameOverStep || gameState.gameOverStep === 'LAST_ROUND') && (
              <div className="space-y-8 animate-fade-in relative z-10">
                <div className="space-y-3">
                  <span className="bg-rose-100 text-rose-800 font-extrabold text-xs px-3.5 py-1 rounded-full uppercase tracking-wider inline-block">
                    STAGE 1 / 3 - LAST ROUND VOTE RESULT 📊
                  </span>
                  <h2 className="font-display font-black text-4xl sm:text-5xl text-slate-900 tracking-tight">
                    📊 마지막 라운드 투표 결과
                  </h2>
                  <p className="text-slate-500 text-sm sm:text-base font-semibold max-w-xl mx-auto">
                    마지막 라운드에서 제출된 팀별 콩 결과입니다. 하단의 버튼을 누르면 최종 결과 발표 화면으로 이동합니다.
                  </p>
                </div>

                {/* Last Round Record Card */}
                {(() => {
                  const record = gameState.roundHistory[gameState.roundHistory.length - 1];
                  if (!record) return null;

                  return (
                    <div className="space-y-6 max-w-2xl mx-auto text-left bg-slate-50 p-6 sm:p-8 rounded-[32px] border-2 border-slate-200 shadow-md">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                        <h3 className="font-display font-black text-lg sm:text-xl text-slate-800 flex items-center space-x-1.5">
                          <span>📊</span>
                          <span>마지막 {record.round}라운드 투표 결과</span>
                        </h3>
                        <span className="bg-rose-100 text-rose-700 text-xs font-black px-3 py-1 rounded-full uppercase">
                          ROUND {record.round} 결과
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                          <h6 className="text-xs uppercase font-extrabold text-slate-400">🔴 레드팀이 제출한 전체 콩 수</h6>
                          <p className="text-2xl font-black text-rose-600 mt-2">
                            {record.winnerTeam === 'RED' ? (
                              <span className="text-xs text-slate-400 font-bold bg-slate-100 px-3 py-1.5 rounded-lg">비공개 (승리팀)</span>
                            ) : (
                              <span className="inline-flex items-center space-x-1.5 bg-amber-400 text-slate-950 px-3 py-1.5 rounded-xl text-base font-black shadow-xs">
                                <span>🫘 {record.redTotalSubmitted}개</span>
                              </span>
                            )}
                          </p>
                        </div>

                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                          <h6 className="text-xs uppercase font-extrabold text-slate-400">⚪ 화이트팀이 제출한 전체 콩 수</h6>
                          <p className="text-2xl font-black text-indigo-600 mt-2">
                            {record.winnerTeam === 'WHITE' ? (
                              <span className="text-xs text-slate-400 font-bold bg-slate-100 px-3 py-1.5 rounded-lg">비공개 (승리팀)</span>
                            ) : (
                              <span className="inline-flex items-center space-x-1.5 bg-amber-400 text-slate-950 px-3 py-1.5 rounded-xl text-base font-black shadow-xs">
                                <span>🫘 {record.whiteTotalSubmitted}개</span>
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="text-center py-4 bg-amber-50 rounded-2xl border border-amber-200">
                        <h4 className="font-display font-black text-base sm:text-lg text-slate-900">
                          {record.winnerTeam === 'DRAW' 
                            ? '무승부! (양 팀 다 동일한 양의 콩을 냈습니다)' 
                            : `${record.winnerTeam === 'RED' ? '⚪ 화이트' : '🔴 레드'}팀 패배: 총 ${record.defeatedTeamTotalBeans}개!`}
                        </h4>
                      </div>
                    </div>
                  );
                })()}

                {/* Step Transition Button */}
                <div className="pt-4 max-w-xl mx-auto">
                  <button
                    onClick={() => {
                      const next = { ...gameState, gameOverStep: 'FINAL_RESULT' as const };
                      broadcastLatestState(next);
                    }}
                    className="w-full bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-700 hover:to-rose-700 text-white font-black text-xl sm:text-2xl py-6 px-8 rounded-3xl shadow-xl transition transform active:scale-95 cursor-pointer flex items-center justify-center space-x-3 border-0"
                  >
                    <Sparkles className="w-7 h-7 text-yellow-300 animate-pulse" />
                    <span>게임 최종 결과 발표 ➡️</span>
                  </button>
                </div>
              </div>
            )}

            {/* STAGE 2: FINAL SCOREBOARD & WINNER ANNOUNCEMENT */}
            {gameState.gameOverStep === 'FINAL_RESULT' && (
              <div className="space-y-8 animate-fade-in relative z-10">
                <div className="space-y-3">
                  <span className="bg-indigo-100 text-indigo-800 font-extrabold text-xs px-3.5 py-1 rounded-full uppercase tracking-wider inline-block">
                    STAGE 2 / 3 - FINAL MATCH RESULT 🏁
                  </span>
                  <h2 className="font-display font-black text-4xl sm:text-5xl text-slate-900 tracking-tight leading-none bg-amber-50 text-amber-600 py-6 px-10 rounded-[24px] inline-block border-2 border-amber-200 shadow-md">
                    🏁 게임 최종 결과 발표 🏁
                  </h2>
                  <p className="text-slate-500 text-base sm:text-lg leading-relaxed font-bold max-w-2xl mx-auto">
                    콩의 딜레마 매치가 성황리에 종료되었습니다!<br />
                    대망의 최종 스코어와 승리 팀을 확인해 보세요.
                  </p>
                </div>

                {/* Winner Team Banner */}
                {gameState.winnerTeam && (
                  <div className="max-w-2xl mx-auto p-1 rounded-3xl bg-gradient-to-r from-rose-500 via-amber-500 to-indigo-500 shadow-xl relative z-10 animate-bounce-subtle">
                    <div className="bg-slate-950 text-white rounded-[22px] py-6 px-8 text-center space-y-2">
                      <span className="text-sm font-extrabold tracking-widest text-amber-400 uppercase block">🏆 CONGRATULATIONS 🏆</span>
                      <h3 className="text-3xl sm:text-4xl font-black tracking-tight">
                        {gameState.winnerTeam === 'RED' && '🔴 RED TEAM 최종 대승리!'}
                        {gameState.winnerTeam === 'WHITE' && '⚪ WHITE TEAM 최종 대승리!'}
                        {gameState.winnerTeam === 'DRAW' && '🤝 양 팀 무승부! 기록적인 명승부'}
                      </h3>
                      <p className="text-xs text-slate-400 font-medium">
                        뛰어난 심리전과 전략적인 투표로 완벽한 결과를 이루어 냈습니다!
                      </p>
                    </div>
                  </div>
                )}

                {/* Scoreboard Table */}
                <div className="rainbow-glow bg-slate-50 rounded-[36px] p-8 sm:p-12 border-4 max-w-2xl mx-auto shadow-2xl relative z-10 bg-gradient-to-br from-indigo-50/20 via-white to-rose-50/20">
                  <div className="flex justify-center items-center space-x-12 sm:space-x-16">
                    {/* Red Team */}
                    <div className="text-center space-y-3">
                      <div className="text-lg sm:text-xl font-extrabold text-rose-600 flex items-center justify-center space-x-1.5">
                        <span className="h-4 w-4 bg-rose-500 rounded-full inline-block shrink-0 shadow-sm" />
                        <span>RED TEAM</span>
                      </div>
                      <div className="text-7xl sm:text-[8rem] font-black font-mono text-slate-900 leading-none tracking-tight">
                        {gameState.redWins}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-400 font-extrabold bg-slate-200/50 px-3 py-1 rounded-full inline-block">
                        {gameState.redWins}라운드 승리
                      </div>
                    </div>
                    
                    <div className="text-5xl sm:text-7xl font-black text-slate-300 font-mono animate-pulse">:</div>
                    
                    {/* White Team */}
                    <div className="text-center space-y-3">
                      <div className="text-lg sm:text-xl font-extrabold text-indigo-600 flex items-center justify-center space-x-1.5">
                        <span className="h-4 w-4 bg-white border border-slate-300 rounded-full inline-block shrink-0 shadow-sm" />
                        <span>WHITE TEAM</span>
                      </div>
                      <div className="text-7xl sm:text-[8rem] font-black font-mono text-slate-900 leading-none tracking-tight">
                        {gameState.whiteWins}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-400 font-extrabold bg-slate-200/50 px-3 py-1 rounded-full inline-block">
                        {gameState.whiteWins}라운드 승리
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step Transition Button */}
                <div className="pt-4 max-w-xl mx-auto">
                  <button
                    onClick={() => {
                      const next = { ...gameState, gameOverStep: 'MVP' as const, revealMvp: true };
                      broadcastLatestState(next);
                    }}
                    className="w-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-black text-xl sm:text-2xl py-6 px-8 rounded-3xl shadow-xl transition transform active:scale-95 cursor-pointer flex items-center justify-center space-x-3 border-0"
                  >
                    <Crown className="w-7 h-7 text-slate-950 fill-slate-950 animate-bounce" />
                    <span>최종 우승자 공개 👑</span>
                  </button>
                </div>
              </div>
            )}

            {/* STAGE 3: MVP REVEAL & CSV DOWNLOAD ACTIVATED */}
            {gameState.gameOverStep === 'MVP' && (
              <div className="space-y-8 animate-fade-in relative z-10">
                <div className="space-y-3">
                  <span className="bg-amber-100 text-amber-800 font-extrabold text-xs px-3.5 py-1 rounded-full uppercase tracking-wider inline-block">
                    STAGE 3 / 3 - FINAL WINNER MVP & CSV DOWNLOAD 👑
                  </span>
                  <h2 className="font-display font-black text-4xl sm:text-5xl text-slate-900 tracking-tight">
                    🎉 최종 우승자(MVP) 🎉
                  </h2>
                  <p className="text-slate-500 text-base font-semibold max-w-xl mx-auto">
                    승리 팀원 중 사물함에 가장 많은 콩을 남긴 영예의 우승자입니다!
                  </p>
                </div>

                {/* MVP Winner Cards */}
                {gameState.mvp && gameState.mvp.length > 0 && (
                  <div className="max-w-2xl mx-auto relative z-10 w-full">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.8, rotate: -2 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 120, damping: 12 }}
                      className="bg-amber-50/80 border-3 border-amber-400 rounded-[32px] p-6 sm:p-8 space-y-4 shadow-xl hover:bg-amber-50 relative overflow-hidden text-center"
                    >
                      <div className="flex items-center justify-center space-x-2 text-amber-600 relative z-10">
                        <Award className="w-8 h-8 text-yellow-500 animate-bounce" />
                        <h4 className="text-2xl sm:text-3xl font-black tracking-tight text-amber-800">🎉 최종 우승자(MVP) 🎉</h4>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
                        {gameState.mvp.map((m, idx) => (
                          <motion.div 
                            key={idx}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 * idx, duration: 0.4 }}
                            className="bg-white rounded-2xl p-5 border border-amber-300 shadow-md flex items-center justify-between text-left"
                          >
                            <div className="flex items-center space-x-3">
                              <span className="text-3xl">⭐</span>
                              <div>
                                <strong className="text-lg font-black text-slate-900">{m.name}</strong>
                                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ml-2 ${
                                  m.team === 'RED' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {m.team === 'RED' ? '레드팀' : '화이트팀'}
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-xs font-black text-slate-400 block">남은 콩</span>
                              <div className="text-xl font-black text-amber-600">{m.beansLeft}개</div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  </div>
                )}

                {/* CSV Result Download Active Banner */}
                <div className="w-full max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 bg-emerald-50 border-2 border-emerald-300 rounded-3xl p-6 relative z-10 text-left animate-fade-in shadow-md">
                  <div className="space-y-1">
                    <span className="bg-emerald-100 text-emerald-800 text-xs uppercase font-black tracking-wider px-2.5 py-0.5 rounded-full">Report Ready 📊</span>
                    <h4 className="text-base font-black text-slate-800">📊 콩의 딜레마 게임 세부 결과 보고서 다운로드</h4>
                    <p className="text-xs text-slate-500 font-medium">모든 라운드별 플레이어 제출 내역과 팀별 총점 데이터가 포함된 CSV 파일입니다.</p>
                  </div>
                  <button
                    onClick={handleDownloadCSV}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm px-6 py-4 rounded-2xl flex items-center space-x-2 transition transform active:scale-95 cursor-pointer border-0 w-full sm:w-auto justify-center shadow-lg shadow-emerald-100 shrink-0"
                  >
                    <Download className="w-5 h-5" />
                    <span>게임 결과 다운로드 (CSV)</span>
                  </button>
                </div>

                {/* Restart Button */}
                <div className="pt-4 max-w-md mx-auto relative z-10">
                  <button
                    onClick={() => {
                      if (syncBridgeRef.current) {
                        syncBridgeRef.current.destroy();
                        syncBridgeRef.current = null;
                      }
                      setMqttConnected(false);
                      setGameState(createInitialState('', ''));
                      setRole(null);
                      setView('HOME');
                    }}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-base px-8 py-4 rounded-2xl shadow-lg transition transform active:scale-95 duration-150 cursor-pointer border-0"
                  >
                    새로운 게임 시작하기 🔄
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

            {/* 📄 showPDFPopup block moved outside main for print compatibility */}

        {/* =============================================================
            7. [🔒 REMOTE TEACHER / MONITORING ADMIN CONTROLLER VIEW]
            ============================================================= */}
        {view === 'ADMIN_CONTROLLER' && (
          <div className="max-w-4xl w-full mx-auto my-6 space-y-6 font-sans animate-fade-in px-4">
            {gameState.status === GameStatus.GAME_OVER && (
              <div className="bg-slate-900 text-white rounded-[28px] p-6 sm:p-8 border-4 border-rose-500 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="text-left space-y-2">
                  <span className="bg-rose-500 text-white text-[10px] uppercase font-black tracking-wider px-2.5 py-1 rounded-full">MATCH FINISHED 🏁</span>
                  <h3 className="text-2xl font-black text-slate-100">🏆 대망의 게임이 최종 종료되었습니다!</h3>
                  <p className="text-xs text-slate-400 font-medium">
                    {(!gameState.gameOverStep || gameState.gameOverStep === 'LAST_ROUND') && '현재 Stage 1: 마지막 라운드 투표 결과가 전광판에 공개 중입니다.'}
                    {gameState.gameOverStep === 'FINAL_RESULT' && '현재 Stage 2: 게임 최종 결과 발표 화면이 공개 중입니다.'}
                    {gameState.gameOverStep === 'MVP' && '현재 Stage 3: 최종 우승자가 공개되었으며 결과 다운로드가 활성화되었습니다.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {(!gameState.gameOverStep || gameState.gameOverStep === 'LAST_ROUND') && (
                    <button
                      onClick={() => {
                        const next = { ...gameState, gameOverStep: 'FINAL_RESULT' as const };
                        broadcastLatestState(next);
                      }}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm px-6 py-3.5 rounded-xl flex items-center space-x-1.5 shadow-lg transition transform active:scale-95 cursor-pointer border-0"
                    >
                      <Sparkles className="w-4 h-4 text-yellow-300" />
                      <span>게임 최종 결과 발표 ➡️</span>
                    </button>
                  )}

                  {gameState.gameOverStep === 'FINAL_RESULT' && (
                    <button
                      onClick={() => {
                        const next = { ...gameState, gameOverStep: 'MVP' as const, revealMvp: true };
                        broadcastLatestState(next);
                      }}
                      className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-black text-sm px-6 py-3.5 rounded-xl flex items-center space-x-1.5 shadow-lg transition transform active:scale-95 cursor-pointer border-0"
                    >
                      <Crown className="w-4 h-4 text-slate-950 fill-slate-950" />
                      <span>최종 우승자 공개 👑</span>
                    </button>
                  )}

                  {gameState.gameOverStep === 'MVP' && (
                    <>
                      <div className="bg-slate-800 text-yellow-300 border border-slate-700 font-extrabold text-xs px-4 py-3 rounded-xl flex items-center space-x-1.5">
                        <Sparkles className="w-4 h-4 text-yellow-400 animate-spin-slow" />
                        <span>최종 우승자 공개됨 🏆</span>
                      </div>
                      <button
                        onClick={handleDownloadCSV}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm px-6 py-3.5 rounded-xl flex items-center space-x-1.5 shadow-lg transition transform active:scale-95 cursor-pointer border-0"
                      >
                        <Download className="w-4 h-4" />
                        <span>게임 결과 다운로드 (CSV)</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ALERT BOX CAUTION WARNING */}
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-3xl p-5 shadow-xs flex items-start space-x-3 text-xs leading-relaxed">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <strong className="font-extrabold block text-sm">⚠️ [교사 보안 통제 전용] 스마트폰 안전 모니터링 화면</strong>
                <p>
                  이 페이지는 콩의 딜레마 실시간 설정과 각 플레이어들이 비공개 제출한 세부 콩 개수 로그를 실시간 모니터링할 수 있는 독립 창입니다.<br />
                  <strong>학생들에게 노출되지 않도록 각별히 유의해 주시기 바랍니다.</strong> 이 기기는 실시간 전광판의 모든 상태를 동일하게 통제할 수 있습니다.
                </p>
              </div>
            </div>

            {/* ⏰ 대형 비밀 투표 마감 타이머 */}
            <div className={`p-6 sm:p-8 rounded-[28px] border-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl transition-all ${
              gameState.status === GameStatus.ROUND_ENDED 
                ? 'bg-red-50/20 border-red-500 shadow-red-100/50'
                : gameState.timerActive 
                  ? 'bg-rose-50 border-rose-600 shadow-rose-100 animate-pulse-subtle' 
                  : 'bg-slate-50 border-slate-600 shadow-slate-150'
            }`}>
              <div className="flex items-center space-x-4 text-left">
                <div className={`p-4 rounded-2xl ${gameState.status === GameStatus.ROUND_ENDED ? 'bg-red-100 text-red-600' : gameState.timerActive ? 'bg-rose-100 text-rose-600' : 'bg-slate-200 text-slate-600'}`}>
                  <Timer className={`w-8 h-8 ${gameState.timerActive ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">⏳ 비밀 투표 마감 타이머</h3>
                  <p className="text-sm font-semibold text-slate-500 mt-1">
                    {gameState.status === GameStatus.ROUND_ENDED 
                      ? '🔴 이번 라운드 비밀 투표가 마감되었습니다.'
                      : gameState.timerActive 
                        ? '🔴 실시간으로 투표를 수령하며 타이머가 작동하고 있습니다.' 
                        : '⏸️ 타이머 작동이 대기 중입니다.'}
                  </p>
                </div>
              </div>
              
              <div className="flex flex-col items-center sm:items-end">
                <span className="text-[11px] text-slate-400 font-extrabold uppercase tracking-widest block mb-1">남은 시간</span>
                <span className="font-display text-5xl sm:text-6xl font-black text-slate-950 font-mono tracking-widest leading-none">
                  {gameState.status === GameStatus.ROUND_ENDED 
                    ? '0:00' 
                    : `${Math.floor(gameState.timeLeft / 60)}:${String(gameState.timeLeft % 60).padStart(2, '0')}`}
                </span>
              </div>
            </div>

            {/* MAIN STATS CARD */}
            <div className="bg-white rounded-3xl border border-slate-150 p-6 shadow-md grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-1 text-center md:text-left">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">실시간 세션 방 코드</span>
                <span className="text-3xl font-display font-black text-rose-600 font-mono select-all">{gameState.roomCode}</span>
              </div>
              
              <div className="space-y-1 text-center md:text-left border-t md:border-t-0 md:border-l border-slate-100 md:pl-6">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">교사용 마스터 비밀번호</span>
                <span className="text-3xl font-display font-black text-slate-800 font-mono select-all">{gameState.masterPassword}</span>
              </div>

              <div className="space-y-1 text-center md:text-left border-t md:border-t-0 md:border-l border-slate-100 md:pl-6">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">현재 게임 상태 / 라운드</span>
                <div className="text-lg font-black text-slate-900 pt-0.5">
                  <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md mr-1">{gameState.status === 'GAME_OVER' ? '종료' : '진행중'}</span>
                  {gameState.currentRound} / {gameState.totalRounds} 라운드
                </div>
              </div>

              <div className="space-y-1 text-center md:text-left border-t md:border-t-0 md:border-l border-slate-100 md:pl-6">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">네트워크 연결 상태</span>
                <div className="text-sm font-black pt-1 flex items-center justify-center md:justify-start">
                  <span className={`inline-block w-2 bg-emerald-500 h-2 rounded-full mr-1.5`}></span>
                  <span className="text-emerald-600">{mqttConnected ? '✅ 실시간 연동 중' : '⚠️ 오프라인 대기'}</span>
                </div>
              </div>
            </div>

            {/* ACTION CONTROL CENTER */}
            <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-lg space-y-4">
              <h4 className="font-display font-black text-lg text-slate-100 flex items-center space-x-2">
                <Settings className="w-5 h-5 text-rose-500" />
                <span>🕹️ 교사 원격 통제 제어판</span>
              </h4>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  onClick={handleToggleTimer}
                  className={`py-3.5 px-4 rounded-2xl text-xs font-black transition-all transform active:scale-95 flex flex-col items-center justify-center space-y-1 cursor-pointer border-0 ${
                    gameState.timerActive 
                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-600' 
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  <Timer className={`w-5 h-5 ${gameState.timerActive ? 'animate-pulse' : ''}`} />
                  <span>{gameState.timerActive ? '⏸️ 일시 정지' : '▶️ 타이머 가동'}</span>
                </button>

                <button
                  onClick={handleResetTimer}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 py-3.5 px-4 rounded-2xl text-xs font-black transition transform active:scale-95 flex flex-col items-center justify-center space-y-1 cursor-pointer border-0"
                >
                  <RefreshCw className="w-5 h-5" />
                  <span>🔄 타이머 리셋</span>
                </button>

                <button
                  onClick={handleImmediateRoundEnd}
                  disabled={gameState.status !== GameStatus.PLAYING}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white py-3.5 px-4 rounded-2xl text-xs font-black transition transform active:scale-95 flex flex-col items-center justify-center space-y-1 cursor-pointer border-0"
                >
                  <Lock className="w-5 h-5 text-red-300" />
                  <span>🔒 투표 즉시 마감</span>
                </button>

                {gameState.status === GameStatus.ROUND_ENDED && !gameState.showRoundResult ? (
                  <button
                    onClick={handleRevealRoundResult}
                    className="bg-purple-600 hover:bg-purple-700 text-white py-3.5 px-4 rounded-2xl text-xs font-black transition transform active:scale-95 flex flex-col items-center justify-center space-y-1 cursor-pointer border-0"
                  >
                    <Eye className="w-5 h-5" />
                    <span>👁️ 라운드 정산 / 공개</span>
                  </button>
                ) : gameState.status === GameStatus.ROUND_ENDED && gameState.showRoundResult ? (
                  <button
                    onClick={handleNextRoundStart}
                    className="bg-blue-600 hover:bg-blue-700 text-white py-3.5 px-4 rounded-2xl text-xs font-black transition transform active:scale-95 flex flex-col items-center justify-center space-y-1 cursor-pointer border-0"
                  >
                    <ArrowLeft className="w-5 h-5 rotate-180" />
                    <span>➡️ 다음 라운드 준비</span>
                  </button>
                ) : (
                  <button
                    disabled
                    className="bg-slate-800 text-slate-500 opacity-50 py-3.5 px-4 rounded-2xl text-xs font-black flex flex-col items-center justify-center space-y-1 border-0"
                  >
                    <EyeOff className="w-5 h-5" />
                    <span>정산 제어 비활성</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-2 justify-between items-center text-xs text-slate-400">
                <span>⏳ 제한 기준 시간: <strong className="text-white">{gameState.timeLimit}초</strong> | 현재 남은 시간: <strong className="text-rose-400 font-bold">{gameState.timeLeft}초</strong></span>
                
                <button
                  onClick={handleEndGameImmediately}
                  className="bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-200 py-1.5 px-3 rounded-lg font-bold"
                >
                  🚨 직권 조기 게임 종료
                </button>
              </div>
            </div>

            {/* SUBMISSION MATRIX */}
            <div className="bg-white rounded-3xl border border-slate-150 p-6 shadow-md space-y-4 text-left">
              <h4 className="font-display font-black text-lg text-slate-800 flex items-center space-x-2">
                <Users className="w-5 h-5 text-rose-500" />
                <span>👥 플레이어 실시간 투표 상황판</span>
              </h4>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {gameState.players.map(p => (
                  <div key={p.id} className="p-3.5 rounded-2xl border border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div>
                      <div className="flex items-center space-x-1">
                        <span className={`w-2.5 h-2.5 rounded-full ${p.team === 'RED' ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                        <strong className="text-sm font-black text-slate-800 select-all">{p.name}</strong>
                      </div>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">사물함 남은 콩: {p.beansInCabinet}개</span>
                    </div>

                    <div>
                      {p.submittedThisRound ? (
                        <span className="inline-flex items-center space-x-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full">
                          <span>제출완료</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-0.5 bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
                          <span>제출중..</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* DETAILED RESULTS LOG TABLE (세부 로그) */}
            <div className="bg-white rounded-3xl border border-slate-150 p-6 shadow-md space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2 text-left">
                <h4 className="font-display font-black text-lg text-slate-800 flex items-center space-x-2">
                  <Database className="w-5 h-5 text-rose-500" />
                  <span>📊 라운드별 제출 세부 로그 (교사용 기밀)</span>
                </h4>
                
                <button
                  onClick={() => {
                    // Download detailed logs as CSV/Text file format
                    try {
                      let text = `=== 콩의 딜레마 게임 결과 세부 데이터 로그 ===\n`;
                      text += `방 코드: ${gameState.roomCode}\n`;
                      text += `출력 날짜: ${new Date().toLocaleString()}\n\n`;
                      
                      gameState.roundHistory.forEach(rec => {
                        text += `-------------------------------------------\n`;
                        text += `[라운드 ${rec.round}]\n`;
                        text += `교과 팀별 제출 콩: RED ${rec.redTotalSubmitted}개 vs WHITE ${rec.whiteTotalSubmitted}개\n`;
                        text += `결과: ${rec.winnerTeam === 'RED' ? 'RED팀 승리' : rec.winnerTeam === 'WHITE' ? 'WHITE팀 승리' : '무승부'}\n`;
                        text += `패배팀 총 콩 수집량: ${rec.defeatedTeamTotalBeans}개\n\n`;
                        
                        text += `개별 인원 제출 현황:\n`;
                        gameState.players.forEach(p => {
                          text += `- ${p.name} (${p.team === 'RED' ? 'RED' : 'WHITE'}): ${p.submittedBeansThisRound}개 제출 (사물함 잔여: ${p.beansInCabinet}개)\n`;
                        });
                        text += `\n`;
                      });

                      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                      const link = document.createElement('a');
                      link.href = URL.createObjectURL(blob);
                      link.download = `beans_dilemma_room_${gameState.roomCode}_detailed_report.txt`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    } catch (err) {
                      alert('로그 다운로드 도중 에러가 발생했습니다: ' + err);
                    }
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl flex items-center space-x-1 transition shadow-xs cursor-pointer border-0"
                >
                  <Download className="w-4 h-4 text-emerald-100" />
                  <span>세부 로그 결과 다운로드 (.txt)</span>
                </button>
              </div>

              {gameState.roundHistory.length === 0 ? (
                <div className="text-center py-8 text-slate-400 font-bold text-xs">
                  아직 완료된 라운드가 없어 세부 데이터 로그가 없습니다. 투표가 마감되면 라운드 내역이 여기에 등재됩니다.
                </div>
              ) : (
                <div className="space-y-4">
                  {gameState.roundHistory.map((rec, rIdx) => (
                    <div key={rIdx} className="border border-slate-150 rounded-2xl p-4 space-y-3 bg-slate-50/50 text-slate-800 text-left">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="font-extrabold text-slate-700">라운드 {rec.round}</span>
                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                          rec.winnerTeam === 'RED' ? 'bg-rose-100 text-rose-700' : rec.winnerTeam === 'WHITE' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {rec.winnerTeam === 'RED' ? '🔴 RED 승리' : rec.winnerTeam === 'WHITE' ? '⚪ WHITE 승리' : '🎗️ 무승부(Draw)'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div className="bg-red-50 text-red-900 p-3 rounded-xl border border-red-100">
                          <strong className="block font-black mb-1">🔴 RED팀 총 제출: {rec.redTotalSubmitted}개</strong>
                          <ul className="space-y-1">
                            {gameState.players.filter(p => p.team === 'RED').map(p => (
                              <li key={p.id} className="flex justify-between text-[11px] text-red-700 font-semibold font-mono">
                                <span>{p.name}:</span>
                                <strong>{p.submittedBeansThisRound ? '🫘 ' : ''}{p.submittedBeansThisRound}개</strong>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-slate-100 text-slate-800 p-3 rounded-xl border border-slate-200">
                          <strong className="block font-black mb-1">⚪ WHITE팀 총 제출: {rec.whiteTotalSubmitted}개</strong>
                          <ul className="space-y-1">
                            {gameState.players.filter(p => p.team === 'WHITE').map(p => (
                              <li key={p.id} className="flex justify-between text-[11px] text-slate-650 font-semibold font-mono">
                                <span>{p.name}:</span>
                                <strong>{p.submittedBeansThisRound ? '🫘 ' : ''}{p.submittedBeansThisRound}개</strong>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-center">
              <button
                onClick={() => {
                  if (window.confirm('기존 전광판 화면으로 돌아가시겠습니까?')) {
                    setView('DISPLAY');
                  }
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-5 py-3 rounded-xl text-xs transition border-0 cursor-pointer"
              >
                관리창 닫기/전광판 화면 이동
              </button>
            </div>
          </div>
        )}

      {/* 📘 [GAME MASTER RULEBOOK AND MANUAL POPUP OVERLAY] */}
      {showGuide && (() => {
        const slides = [
          {
            title: '게임 소개',
            emoji: '🎮',
            badge: 'Game Introduction',
            paragraphs: [
              '모든 플레이어는 화이트와 레드 두 팀으로 나눠 대결합니다.',
              '매 라운드마다 플레이어는 자신이 보유한 콩을 배팅하고 더 많은 콩을 배팅한 팀이 승리합니다.',
              '더 많은 라운드를 이긴 팀이 승리하고 이긴 팀에서 가장 많은 콩을 보유한 플레이어가 최종 우승을 하게 됩니다.',
              '공동의 이익과 개인의 이익 사이에서 고민하며 고도의 심리전과 전략 게임을 시작해보세요!'
            ]
          },
          {
            title: '팀 배정 및 사전 설정',
            emoji: '⚙️',
            badge: 'Setup',
            paragraphs: [
              '1. 메인화면에서 \'새로운 게임방 개설\'버튼을 클릭해 게임을 개설하세요.',
              '2. 게임의 라운드는 5라운드 고정이며 팀은 화이트/레드 팀으로 구분됩니다.',
              '3. 라운드 타이머 및 플레이어를 생성해 주세요.',
              '※ 플레이어가 14명 이상 넘어가면 게임 운영이 어렵습니다. 2인 1조로 팀 구성하실 것을 권장합니다.',
              '4. 게인 전광판 패스워드를 정해주세요. 학생 중계 화면과 게임 화면 연동을 위한 패스워드입니다.',
              '5. 팀 배정을 하고 PDF 출력해 학생들에게 나눠주세요.'
            ]
          },
          {
            title: '게임 진행',
            emoji: '🚀',
            badge: 'Gameplay Phase 1',
            paragraphs: [
              '1. 게임 시작하고 보이는 화면은 \'비밀의 방\'페이지 입니다. 교사PC 듀얼모니터 기준으로 TV와 연결되지 않은 모니터에 띄워주세요.',
              '2. 비밀의 방 페이지 하단에 \'게임 전광판으로 이동\' 버튼을 이용해 게임 전광판 페이지를 띄워주세요. 이 페이지는 학생들 모두 볼 수 있도록 TV에 띄워주세요.',
              '3. 게임 전광판 접속을 위한 방 코드와 비밀번호는 출력된 PDF에 적혀있습니다.'
            ]
          },
          {
            title: '게임 진행',
            emoji: '🗳️',
            badge: 'Gameplay Phase 2',
            paragraphs: [
              '1. 라운드 진행 시간 동안 학생들이 자유롭게 전략을 짜고 실행할 수 있도록 해주세요.',
              '2. 몇 개의 콩을 해당 라운드에 제출할지 결정한 플레이어는 교사에게 의사를 전달하고 \'비밀의 방\'페이지에서 자신의 사물함을 열어 콩을 제출합니다.',
              '※ 비밀번호가 노출되지 않도록 학생들에게 주의를 주세요.',
              '3. 모든 플레이어가 콩을 제출하고 난 뒤 상단에 \'즉시 투표 종료\'버튼을 누르거나 타이머가 0이 될 때까지 기다리세요.',
              '4. 투표 마감이 되고 결과가 공개됩니다. 패배팀이 제출한 전체 콩만 공개됩니다.'
            ]
          },
          {
            title: '게임 종료',
            emoji: '🏁',
            badge: 'End Game',
            paragraphs: [
              '1. 5번의 라운드 중 3번을 먼저 이기게 되면 게임이 종료됩니다.',
              '2. 라운드 우승은 팀 전체에서 제출한 콩으로 결정하지만 게임의 최종 우승은 보유하고 있는 남은 콩의 개수로 합니다.',
              '3. 우승 팀에서 가장 많은 콩을 남긴 학생이 최종 우승이 됩니다.'
            ]
          },
          {
            title: '전략',
            emoji: '💡',
            badge: 'Strategy Tip',
            paragraphs: [
              '1. 학생들이 충분한 상의와 전략적 사고를 통해 게임에 참여할 수 있도록 해주세요.',
              '2. 공동의 이익과 개인의 이익 사이에서 고민하게 됩니다. ',
              '3. 단순히 상대를 속이는 행위에 몰두하지 않도록 해주세요.',
              '4. 유튜브에서 지니어스 게임-콩의 딜레마 영상을 검색해 시청하시면 게임 이해에 도움이 됩니다.'
            ]
          }
        ];

        const activeSlide = slides[guideSlide];

        return (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-fade-in overflow-y-auto">
            <div className="bg-white rounded-[32px] max-w-2xl w-full p-6 sm:p-8 shadow-2xl border-2 border-indigo-100 text-left flex flex-col justify-between min-h-[480px] max-h-[90vh] overflow-y-auto font-sans animate-scale-in relative">
              
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h4 className="font-display font-black text-xl sm:text-2xl text-slate-900 flex items-center space-x-2">
                    <span>📘 콩의 딜레마 사용설명서</span>
                  </h4>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-wider block mt-1 w-max">
                    {activeSlide.badge}
                  </span>
                </div>
                <button 
                  onClick={() => setShowGuide(false)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-center border-none bg-transparent cursor-pointer text-xl p-1"
                >
                  ✕
                </button>
              </div>

              {/* Slider Content Frame */}
              <div className="flex-1 py-6 flex flex-col justify-start space-y-4">
                {/* Title */}
                <div className="flex items-center space-x-3">
                  <span className="text-3xl select-none">{activeSlide.emoji}</span>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-950">
                    {activeSlide.title}
                  </h3>
                </div>

                {/* Body Paragraphs Render */}
                <div className="space-y-3 pl-1">
                  {activeSlide.paragraphs.map((para, pIdx) => {
                    const isWarning = para.startsWith('※');
                    const isListItem = /^[0-9]\./.test(para);

                    return (
                      <div 
                        key={pIdx} 
                        className={`text-sm sm:text-base leading-relaxed p-3.5 rounded-2xl border-0 ${
                          isWarning 
                            ? 'bg-rose-50 text-rose-700 font-bold border border-rose-150' 
                            : isListItem 
                              ? 'bg-slate-50 text-slate-800 font-semibold' 
                              : 'text-slate-700 font-medium'
                        }`}
                      >
                        {para}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer with slides control */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100 flex-wrap gap-4">
                {/* Slide Count Indicator Dots */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs sm:text-sm font-black text-slate-500 mr-2">
                    {guideSlide + 1} / {slides.length}
                  </span>
                  <div className="flex items-center space-x-1.5">
                    {slides.map((_, dotIdx) => (
                      <button
                        key={dotIdx}
                        onClick={() => setGuideSlide(dotIdx)}
                        className={`w-2.5 h-2.5 rounded-full transition-all duration-200 border-0 p-0 cursor-pointer ${
                          guideSlide === dotIdx 
                            ? 'bg-indigo-600 w-5' 
                            : 'bg-slate-200 hover:bg-slate-350'
                        }`}
                        title={`${dotIdx + 1}번 슬라이드로 이동`}
                      />
                    ))}
                  </div>
                </div>

                {/* Pre / Next Actions */}
                <div className="flex items-center space-x-2">
                  <button
                    disabled={guideSlide === 0}
                    onClick={() => setGuideSlide(prev => Math.max(0, prev - 1))}
                    className={`px-4 py-2.5 rounded-xl text-xs font-black transition border-0 cursor-pointer select-none ${
                      guideSlide === 0 
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    ◀ 이전
                  </button>

                  {guideSlide < slides.length - 1 ? (
                    <button
                      onClick={() => setGuideSlide(prev => Math.min(slides.length - 1, prev + 1))}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-black transition border-0 cursor-pointer select-none shadow-md"
                    >
                      다음 ▶
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowGuide(false)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-xs font-black transition border-0 cursor-pointer select-none shadow-md"
                    >
                      설명서 닫기 ✓
                    </button>
                  )}
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* 🤫 [STUDENT CABINET CONNECTION MODAL] */}
      {showStudentConnectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-fade-in text-sans">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100/50 text-center space-y-4">
            <span className="text-4xl text-center select-none block animate-bounce-subtle">🤫</span>
            <h4 className="font-display font-black text-lg text-slate-900">
              학생 비밀의 방 참가
            </h4>
            
            <div className="text-left space-y-3 font-semibold text-xs text-slate-500">
              <div>
                <label className="block font-bold text-slate-500 mb-1">기기 연결 코드를 입력해 주세요.</label>
                <input
                  type="text"
                  maxLength={4}
                  placeholder="방 코드 4자리 입력"
                  value={roomCodeInput}
                  onChange={(e) => {
                    setRoomCodeInput(e.target.value.trim().toUpperCase());
                    setLobbyError('');
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-center text-lg font-mono font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-800"
                />
              </div>

              {lobbyError && (
                <p className="text-red-500 text-xs font-bold text-center mt-1">{lobbyError}</p>
              )}
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => {
                  setShowStudentConnectModal(false);
                  setLobbyError('');
                }}
                className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs transition border border-slate-200 cursor-pointer"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  const roundedCode = roomCodeInput.trim();
                  if (!roundedCode) {
                    setLobbyError('기기 연결 코드를 입력해 주세요.');
                    return;
                  }
                  if (roundedCode.length !== 4 || isNaN(Number(roundedCode))) {
                    setLobbyError('기기 연결 코드 4자리를 정확히 입력해주세요.');
                    return;
                  }
                  
                  // Connect as student
                  setRole('CLIENT');
                  establishSync(roundedCode, 'CLIENT');
                  setView('STUDENT_LOBBY');
                  setShowStudentConnectModal(false);
                }}
                className="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs transition shadow-md border-0 cursor-pointer"
              >
                완료 및 입장 🤫
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📺 [GAME DISPLAY BOARD CONNECTION MODAL] */}
      {showDisplayConnectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-fade-in text-sans">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100/50 text-center space-y-4">
            <span className="text-4xl text-center select-none block animate-bounce-subtle">📺</span>
            <h4 className="font-display font-black text-lg text-slate-900">
              게임 전광판 연결
            </h4>
            
            <div className="text-left space-y-3 font-semibold text-xs text-slate-500">
              <div>
                <label className="block font-bold text-slate-500 mb-1">기기 연결 코드를 입력해 주세요.</label>
                <input
                  type="text"
                  maxLength={4}
                  placeholder="방 코드 4자리 입력"
                  value={roomCodeInput}
                  onChange={(e) => {
                    setRoomCodeInput(e.target.value.trim().toUpperCase());
                    setLobbyError('');
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-center text-lg font-mono font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-500 mb-1">전광판 보안 비밀번호</label>
                <input
                  type="password"
                  placeholder="보안 비밀번호 4자리 입력"
                  value={masterPasswordInput}
                  onChange={(e) => {
                    setMasterPasswordInput(e.target.value);
                    setLobbyError('');
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-center text-lg font-mono focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-800"
                />
              </div>

              {lobbyError && (
                <p className="text-red-500 text-xs font-bold text-center mt-1">{lobbyError}</p>
              )}
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => {
                  setShowDisplayConnectModal(false);
                  setLobbyError('');
                }}
                className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs transition border border-slate-200 cursor-pointer"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  const roundedCode = roomCodeInput.trim();
                  if (!roundedCode) {
                    setLobbyError('기기 연결 코드를 입력해 주세요.');
                    return;
                  }
                  
                  // Connect
                  enterDisplayBoard();
                }}
                className="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs transition shadow-md border-0 cursor-pointer"
              >
                연결 및 활성화 ⚡
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔐 [STUDENT CABINET CONFIRM POPUP MODAL] */}
      {showCabinetConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-fade-in">
          <div className="bg-white rounded-[32px] max-w-sm w-full p-6 sm:p-7 shadow-2xl border-4 border-rose-500 text-center space-y-5">
            <span className="text-4xl text-center select-none block">🔐</span>
            
            <h4 className="font-display font-black text-xl text-slate-900">
              내 사물함이 맞는지 확인해 주세요.
            </h4>
            
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs sm:text-sm text-slate-700 font-bold leading-relaxed">
              친구의 사물함을 열어보는 것은 공정한 게임 활동을 방해하는 행동입니다. 내 사물함만 열어보세요.
            </div>

            <p className="text-xs text-slate-400 font-semibold">
              선택한 학생: <strong className="text-slate-800 text-sm">{showCabinetConfirmModal.name}</strong>
            </p>

            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => setShowCabinetConfirmModal(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3 px-4 rounded-xl text-sm transition cursor-pointer border-0"
              >
                아니오
              </button>
              <button
                onClick={() => {
                  const player = showCabinetConfirmModal;
                  setAuthPlayerId(player.id);
                  setCabinetBeansLeft(player.beansInCabinet);
                  setCabinetBeansSubmitted(0);
                  setView('STUDENT_ACTIVE_CABINET');
                  setShowCabinetConfirmModal(null);
                }}
                className="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-black py-3 px-4 rounded-xl text-sm transition shadow-md cursor-pointer border-0"
              >
                네
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚠️ [TEMPORARY DISPLAY REDIRECT ALERT POPUP] */}
      {showTempDisplayAlert && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-fade-in text-sans">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100/50 text-center space-y-4 relative">
            {/* Upper Right X button */}
            <button 
              onClick={() => setShowTempDisplayAlert(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition p-1 rounded-full cursor-pointer border-0 bg-transparent"
              title="닫기"
            >
              <XCircle className="w-5 h-5" />
            </button>

            <span className="text-4xl text-center select-none block animate-bounce-subtle">📢</span>
            <h4 className="font-display font-black text-lg text-slate-900">
              새 창 열기 안내
            </h4>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              현재 학생용 '비밀의 방' 탭은 그대로 유지하면서, 교사용 전광판 활성화를 위해 <strong>새로운 인터넷 창(새 탭)</strong>을 띄워 메인화면으로 이동합니다.<br />
              <span className="text-[10px] text-amber-600 block mt-1">※ 브라우저 팝업이 차단된 경우, 주소창 우측에서 팝업 허용을 승인해 주세요.</span>
            </p>

            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => setShowTempDisplayAlert(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-2.5 rounded-xl text-xs transition cursor-pointer border-0"
              >
                취소/닫기
              </button>
              <button
                onClick={() => {
                  setShowTempDisplayAlert(false);
                  
                  // Attempt to open in a new window/tab so that original student room stays intact
                  try {
                    const nextUrl = window.location.origin + window.location.pathname;
                    const newTab = window.open(nextUrl, '_blank');
                    if (!newTab) {
                      // Confined by sandbox/popup bloker, redirect current window as fallback
                      setView('HOME');
                    }
                  } catch (err) {
                    console.warn("window.open popups might be blocked in sandbox, active fallback", err);
                    setView('HOME');
                  }
                }}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-3 py-2.5 rounded-xl text-xs transition shadow-md cursor-pointer border-0"
              >
                새 창으로 이동
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🎮 [GAME START CHANNELS BRANCHING MODAL] */}
      {showGameStartModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-fade-in text-sans">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-100/50 text-center space-y-6">
            <span className="text-5xl text-center select-none block animate-bounce-subtle">🎮</span>
            <div className="space-y-2">
              <h4 className="font-display font-black text-xl text-slate-900">
                게임 시작하기
              </h4>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                새로운 게임방을 개설하여 게임을 처음 시작하거나,<br />
                이미 개설된 게임방의 비밀의 방(학생 화면)을 이 기기에서 연결하여 계속해서 진행할 수 있습니다.
              </p>
            </div>

            <div className="flex flex-col space-y-3">
              <button
                onClick={() => {
                  setShowGameStartModal(false);
                  setRoomCodeInput('');
                  setRole('CLIENT');
                  setView('PRE_SETTING');
                }}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-5 py-4 rounded-2xl text-sm transition shadow-md border-0 cursor-pointer flex flex-col items-center justify-center space-y-0.5"
              >
                <span>🛠️ 새로운 게임방 개설</span>
                <span className="text-[10px] text-slate-400 font-medium">(교사 사전 설정실 진입)</span>
              </button>

              <button
                onClick={() => {
                  setShowGameStartModal(false);
                  setShowContinueGameModal(true);
                  setContinueRoomCode('');
                  setContinuePassword('');
                  setContinueError('');
                }}
                className="w-full bg-rose-500 hover:bg-rose-600 text-white font-extrabold px-5 py-4 rounded-2xl text-sm transition shadow-md border-0 cursor-pointer flex flex-col items-center justify-center space-y-0.5"
              >
                <span>🔗 기존 게임 이어하기</span>
                <span className="text-[10px] text-rose-100 font-medium">(다른 기기에서 비밀의 방 연결)</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowGameStartModal(false)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs transition border-0 cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔗 [CONTINUE GAME CONNECT MODAL] */}
      {showContinueGameModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-fade-in text-sans">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100/50 text-center space-y-4">
            <span className="text-4xl text-center select-none block">🔗</span>
            <h4 className="font-display font-black text-lg text-slate-900">
              기존 게임방 이어하기
            </h4>
            
            <div className="text-left space-y-3 font-semibold text-xs text-slate-500">
              <div>
                <label className="block font-bold text-slate-500 mb-1">게임방 번호 (4자리)</label>
                <input
                  type="text"
                  maxLength={4}
                  placeholder="방 코드 4자리 입력"
                  value={continueRoomCode}
                  onChange={(e) => {
                    setContinueRoomCode(e.target.value.trim().replace(/[^0-9]/g, ''));
                    setContinueError('');
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-center text-lg font-mono font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-500 mb-1">교사용 마스터 비밀번호</label>
                <input
                  type="password"
                  placeholder="마스터 비밀번호 입력"
                  value={continuePassword}
                  onChange={(e) => {
                    setContinuePassword(e.target.value.trim());
                    setContinueError('');
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-center text-lg font-mono focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-800"
                />
              </div>

              {continueError && (
                <p className="text-red-500 text-xs font-bold text-center mt-1">{continueError}</p>
              )}
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                disabled={isConnectingContinue}
                onClick={() => {
                  setShowContinueGameModal(false);
                  setContinueError('');
                }}
                className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs transition border border-slate-200 cursor-pointer disabled:opacity-50"
              >
                뒤로
              </button>
              <button
                disabled={isConnectingContinue}
                onClick={handleContinueGameConnect}
                className="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs transition shadow-md border-0 cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-1"
              >
                <span>{isConnectingContinue ? '연결 중...' : '연결 및 입장 🔓'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      </main>

      {/* 📄 [PRINTABLE LEDGER DIALOG OVERLAY] (Moved outside main to prevent being affected by print:hidden) */}
      {showPDFPopup && (
        <div className="printable-ledger-modal fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in overflow-y-auto flex-col">
          <div className="printable-ledger-card bg-white rounded-3xl max-w-5xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 text-left space-y-6 max-h-[90vh] overflow-y-auto animate-scale-in">
            
            {/* Header / Actions bar */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 flex-wrap gap-3 font-sans print:hidden">
              <div>
                <h4 className="font-display font-black text-xl text-slate-900 flex items-center space-x-2">
                  <span>📄 플레이어 정보 및 비밀번호 대장</span>
                </h4>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopyClipboardLedger}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-4 py-3 rounded-xl flex items-center space-x-1.5 transition shadow-xs cursor-pointer border-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>전체 텍스트 복사 (엑셀/한글용)</span>
                </button>
                
                <button
                  onClick={() => {
                    try {
                      window.print();
                    } catch (err) {
                      console.warn("Print trigger ignored or blocked", err);
                    }
                  }}
                  className="bg-rose-500 hover:bg-rose-600 text-white font-extrabold text-xs px-4 py-3 rounded-xl flex items-center space-x-1.5 transition shadow-xs cursor-pointer border-0"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>PDF 출력</span>
                </button>
                <button
                  onClick={() => setShowPDFPopup(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs px-4 py-3 rounded-xl transition cursor-pointer border-0"
                >
                  닫기
                </button>
              </div>
            </div>

            {/* Sandboxed notice alert banner (Requirement 1 fallback) */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start space-x-3 text-amber-900 text-xs shadow-xs print:hidden animate-fade-in">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1 font-sans">
                <strong className="font-extrabold block">💡 인쇄 / PDF 출력 에러 안내 및 빠른 복사 도구 배포</strong>
                <p className="leading-relaxed">
                  현재 우측 상단 <strong>[새 탭에서 열기 ↗]</strong>를 누르지 않고 iframe 미리보기 창 내부 상태에서 PDF 출력을 누르시면 보안 정책상 출력이 생략될 수 있습니다.<br />
                  정상적인 인쇄를 위해 새 탭에서 열고 진행하시거나, 바로 옆의 <strong>[전체 텍스트 복사 (엑셀/한글용)]</strong> 버튼을 터치하여 엑셀이나 한글 문서에 붙여넣기(Ctrl+V)하시면 완벽한 표로 자동 완성되어 간편하게 실물 자르기 인쇄물을 보급할 수 있습니다.
                </p>
              </div>
            </div>

            {/* Printable Document Style Frame */}
            <div className="print-area-wrapper p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-6 font-sans print:bg-white print:border-none print:p-0">
              <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                  /* 1. Hide other layout containers and the screen popup to prevent dual printing */
                  header, footer, main, .printable-ledger-modal {
                    display: none !important;
                  }
                  /* 2. Reset html, body, and all layout parent containers for print */
                  html, body, #root, .min-h-screen {
                    margin: 0 !important;
                    padding: 0 !important;
                    height: auto !important;
                    min-height: 0 !important;
                    overflow: visible !important;
                    background: #ffffff !important;
                    display: block !important;
                  }
                  /* 3. Strip all fixed/modal positioning, shadow, background layer, and scrollbars from the modal container */
                  .printable-ledger-modal {
                    position: static !important;
                    display: block !important;
                    width: 100% !important;
                    height: auto !important;
                    overflow: visible !important;
                    background: transparent !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    border: none !important;
                    box-shadow: none !important;
                    z-index: auto !important;
                  }
                  /* 4. Strip all fixed width, height, scrollbar, border and shadow from the modal card */
                  .printable-ledger-card {
                    position: static !important;
                    display: block !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    height: auto !important;
                    max-height: none !important;
                    overflow: visible !important;
                    background: #ffffff !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    border: none !important;
                    box-shadow: none !important;
                  }
                  /* Retain background colors, shadows, text metrics, and force disable active animation states during printing */
                  * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    animation: none !important;
                    transition: none !important;
                  }
                  .print-area-wrapper {
                    display: block !important;
                    width: 100% !important;
                    background: white !important;
                    box-shadow: none !important;
                    border: none !important;
                    margin: 0 !important;
                    padding: 10px !important;
                    overflow: visible !important;
                  }
                  /* 5 Column layout to perfectly utilize horizontal spacing */
                  .print-grid-container {
                    display: grid !important;
                    grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
                    gap: 12px !important;
                    border-top: 1px dashed #94a3b8 !important;
                    border-left: 1px dashed #94a3b8 !important;
                    background-color: white !important;
                    width: 100% !important;
                  }
                  .print-grid-item {
                    border-right: 1px dashed #94a3b8 !important;
                    border-bottom: 1px dashed #94a3b8 !important;
                    padding: 8px !important;
                    background: transparent !important;
                    display: flex !important;
                    flex-direction: column !important;
                    justify-content: space-between !important;
                    break-inside: avoid !important;
                    page-break-inside: avoid !important;
                  }
                  .print-inner-box {
                    border: 1px solid #cbd5e1 !important;
                    padding: 12px !important;
                    border-radius: 8px !important;
                    background-color: white !important;
                    text-align: center !important;
                    display: flex !important;
                    flex-direction: column !important;
                    justify-content: space-between !important;
                    height: 100% !important;
                    box-shadow: none !important;
                  }
                }
              ` }} />

              <div className="text-center space-y-2 border-b-2 border-dashed border-slate-300 pb-4">
                <h2 className="text-2xl font-black text-slate-800">🫘 플레이어 정보 및 비밀번호</h2>
                <div className="flex flex-wrap justify-center gap-4 text-xs font-semibold text-slate-500 pt-1">
                  <span>🏫 연결 코드: <strong className="text-rose-600 font-extrabold text-sm">{preSettingRoomCode || gameState.roomCode || '임시 발급용'}</strong></span>
                  <span>🛡️ 전광판 패스워드: <strong className="text-slate-800 font-bold">{masterPasswordSetting || gameState.masterPassword}</strong></span>
                  <span>📅 생성 시각: {new Date().toLocaleDateString()}</span>
                </div>
              </div>

              {/* Grid cards representing each team student credentials */}
              <div className="print-grid-container grid grid-cols-2 lg:grid-cols-5 border-t border-l border-dashed border-slate-400 bg-white print:grid-cols-5">
                {(tempPlayers.length > 0 ? tempPlayers : gameState.players).map((p, idx) => (
                  <div 
                    key={p.id} 
                    className="print-grid-item border-r border-b border-dashed border-slate-400 p-4.5 relative bg-transparent flex flex-col justify-between"
                  >
                    <div className="print-inner-box border border-slate-200 p-4 rounded-xl bg-white flex flex-col justify-between text-center space-y-3 relative overflow-hidden h-full shadow-xs">
                      <span className="absolute top-1.5 right-1.5 text-[9px] text-slate-400 select-none">✂️ 자르는 선</span>
                      <div className="text-[10px] text-slate-400 font-mono font-bold select-none text-left">No. {idx + 1}</div>
                      
                      <div className="font-display font-black text-sm text-slate-850 leading-tight">
                        {p.name}
                      </div>
                      
                      <div>
                        <span className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-black select-none ${
                          p.team === 'RED' 
                            ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                            : p.team === 'WHITE' 
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' 
                              : 'bg-slate-100 text-slate-500'
                        }`}>
                          {p.team === 'RED' ? '🔴 RED' : p.team === 'WHITE' ? '⚪ WHITE' : '미정'}
                        </span>
                      </div>
                      
                      <div className="bg-yellow-50 border border-yellow-200 py-2 px-0.5 rounded-lg font-mono">
                        <span className="block text-[8px] font-extrabold text-amber-500 uppercase tracking-wider leading-none mb-1 select-none">비밀번호</span>
                        <span className="font-black text-rose-600 text-sm tracking-widest">{p.password}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-center space-y-1.5 pt-4 border-t border-dashed border-slate-200 select-none print:visible">
                <p className="text-xs text-rose-600 font-black">
                  플레이어 정보 및 비밀번호를 출력 후 잘라 학생들에게 나눠주세요.
                </p>
                <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                  ⓒ 2026. Kwon's class. All rights reserved.
                </p>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="py-6 border-t border-gray-100 bg-white text-center text-[10px] text-gray-400 font-medium tracking-wide print:hidden">
        <p>ⓒ 2026. Kwon's class. All rights reserved.</p>
      </footer>
    </div>
  );
}
