@echo off
chcp 65001 > nul
title Bandicam Lite - GitHub 업로드 도구
cd /d "%~dp0"

echo ========================================================
echo   Bandicam Lite v0.1.0-test 깃허브 원클릭 푸시 도구
echo ========================================================
echo.

git --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [오류] PC에 Git이 설치되어 있지 않습니다.
    echo Git을 먼저 설치해 주세요: https://git-scm.com/
    pause
    exit /b
)

if not exist ".git" (
    echo [1/4] Git 저장소 초기화 중...
    git init
    git branch -M main
)

echo [2/4] 파일 스테이징 및 커밋 생성...
git add .
git commit -m "feat: Bandicam Lite v0.1.0-test desktop installer and web test"

echo.
echo [3/4] 깃허브 원격 저장소 연결
set /p REPO_URL="깃허브 저장소 주소를 입력하세요 (예: https://github.com/사용자명/저장소명.git): "

if "%REPO_URL%"=="" (
    echo [경고] 주소가 입력되지 않았습니다.
    pause
    exit /b
)

git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo.
echo [4/4] 깃허브로 푸시 중 (v0.1.0-test)...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo  [성공] 깃허브 업로드가 완료되었습니다!
    echo.
    echo  * 깃허브 저장소의 [Settings] - [Pages]에서 Source를
    echo    'GitHub Actions'로 선택하시면 웹 테스트 주소가 활성화됩니다.
    echo ========================================================
) else (
    echo.
    echo [오류] 푸시 중 문제가 발생했습니다. 로그인 상태나 권한을 확인해 주세요.
)

pause
