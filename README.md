# 콩의 딜레마 — WebRTC 안정성 강화판

Firebase 없이 PeerJS WebRTC로 교사 Host, 학생 기기, 전광판, 원격 운영 화면을 연결하는 학급용 게임입니다.

## 로컬 실행

사전 준비: Node.js


1. Install dependencies:
   `npm install`
2. 앱을 실행합니다.
   `npm run dev`

## 검증

- `npm run lint`
- `npm run build`

안정성 구현은 `WEBRTC_MIGRATION.md`, 디자인 제작 목록과 프롬프트는 `DESIGN_ASSET_GUIDE.md`를 참고하세요.

## 적용된 미디어

```text
public/
├── audio/
│   ├── bgm/        # 메인 진행곡, 결과 발표곡
│   └── sfx/        # 결과 공개, 승리, 사물함 효과음
└── images/
    ├── backgrounds/ # 메인·비밀의 방·운영실·전광판·결과 배경
    ├── icons/       # 팀 문장·콩·금고·MVP 아이콘
    └── logo/        # 게임 로고
```

- `bgm_main.mp3`는 게임 시작 후 운영 중 반복 재생됩니다.
- `bgm_result.mp3`는 최종 결과 단계 진입 시 메인 BGM을 대신해 반복 재생됩니다.
- 일반 버튼 피드백은 Web Audio API로 생성하며, 제공된 전문 효과음만 파일로 재생합니다.
- 결과 화면의 복사 버튼은 탭으로 구분된 전체 기록을 클립보드에 넣어 한셀/엑셀에 바로 붙여넣을 수 있습니다.
