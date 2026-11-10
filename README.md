# 수지캠 (SuziCam)

![Version](https://img.shields.io/badge/version-v0.1.0--test-red.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Web-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**수지캠 (SuziCam)**은 가볍고 빠른 **설치형 데스크톱 화면 녹화기 (Windows .exe)** 및 **웹 라이브 테스트 환경**을 제공합니다.

---

## 📌 테스트 버전 정보
* **버전**: `v0.1.0-test (Alpha Build)`
* **출시 일자**: 2026-11-09

---

## 🚀 1. 웹에서 바로 테스트하기 (GitHub Pages)
프로그램을 별도로 설치하지 않고 웹 브라우저에서 바로 화면 녹화와 테스트 벤치를 실행해 볼 수 있습니다:
* **웹 라이브 테스트 주소**: [https://kookppong.github.io/cam-lite/](https://kookppong.github.io/cam-lite/)

---

## 💻 2. PC 설치형 프로그램 (.exe)

GitHub에 푸시되면 GitHub Actions가 자동으로 Windows 설치 프로그램을 빌드합니다.

* **설치 파일 형태**:
  * `SuziCam Setup 0.1.0-test.exe` (바탕화면/시작메뉴 바로가기 설치형)
  * `SuziCam 0.1.0-test.exe` (설치 없이 바로 실행되는 무설치 포터블형)
* **다운로드 위치**: [Releases 탭 (v0.1.0-test)](https://github.com/kookppong/cam-lite/releases)

---

## 🛠️ 주요 기능
1. **수지캠 UI 구성**:
   - 상단 헤더에 `v0.1.0-test` 버전 태그 표시
   - 실시간 디지털 타이머 (`00:00:00.000`)
   - 대형 빨간색 **REC / STOP** 토글 버튼 및 일시정지 버튼
2. **실시간 화면 검증 테스트 벤치 내장**:
   - 60 FPS 바운싱 볼 애니메이션 (녹화 프레임 드랍 검증)
   - 1초 주기 비프음 (오디오/비디오 싱크 밀림 검증)
   - 마우스 커서 클릭 감지 영역
3. **결과 확인 및 저장**:
   - 녹화 완료 즉시 플레이어에서 재생 확인
   - `webm` / `mp4` 원클릭 다운로드
