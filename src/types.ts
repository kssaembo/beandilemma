/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum GameStatus {
  LOBBY = 'LOBBY',
  SETTING = 'SETTING',
  PLAYING = 'PLAYING',
  ROUND_ENDED = 'ROUND_ENDED',
  GAME_OVER = 'GAME_OVER'
}

export interface Player {
  id: string;
  name: string;
  team: 'RED' | 'WHITE';
  password: string;         // 4자리 고유 비밀번호
  beansInCabinet: number;   // 사물함 속 남은 콩 개수 (초기값: 15)
  submittedThisRound: boolean;
  submittedBeansThisRound: number; // 이번 라운드에 낸 콩 개수
}

export interface RoundRecord {
  round: number;
  redTotalSubmitted: number;
  whiteTotalSubmitted: number;
  winnerTeam: 'RED' | 'WHITE' | 'DRAW';
  defeatedTeamTotalBeans: number; // 진 팀의 총 콩 개수 (공개용)
  playerSubmissions?: { name: string; team: 'RED' | 'WHITE'; beans: number; }[];
}

export interface GameState {
  roomCode: string;          // 4자리 기기 연결 코드
  masterPassword: string;    // 교사용 마스터 비밀번호
  status: GameStatus;
  currentRound: number;
  totalRounds: number;        // 기본 5
  timeLimit: number;         // 타이머 제한시간(초), 기본 120초
  timeLeft: number;          // 남은 시간
  timerActive: boolean;
  players: Player[];
  redWins: number;           // 레드팀 승수
  whiteWins: number;         // 화이트팀 승수
  roundHistory: RoundRecord[];
  showRoundResult: boolean;  // 전광판 결과 공개 활성화 여부
  lastUpdated: number;       // 동기화 시간용 타임스탬프
  winnerTeam: 'RED' | 'WHITE' | 'DRAW' | null;
  mvp: {
    name: string;
    team: 'RED' | 'WHITE';
    beansLeft: number;
  }[] | null;
  revealMvp?: boolean;
  gameOverStep?: 'LAST_ROUND' | 'FINAL_RESULT' | 'MVP';
}
