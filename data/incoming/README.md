# 연간 전체 표 입력

GitHub에서 연간 누적 유저·별풍선 표를 `data/incoming/annual.txt`로 업로드한 뒤 **Manual ranking update**를 `mode=annual_batch`로 실행한다. 표는 1월 1일부터 observed_at까지의 연간값이어야 한다. 월간·최근 30일 표를 입력하지 않는다.

`annual_table_path`는 이 폴더의 `.txt` 파일만 허용한다. 이 입력 파일은 배포하지 않으며 gitignore 대상이다. 웹 편집으로 커밋하거나 CLI에서 명시적으로 추가할 수 있다. GitHub에 공개하고 싶지 않은 메모·개인정보·인증정보를 표에 넣지 않는다.

수동 workflow를 먼저 `dry_run=true`로 실행해 매칭 수·보정값·예상 순위·목표를 확인한다. 누락 후보는 기존 관측으로 남기며, 새 전체 관측인 것처럼 그래프에 추가하지 않는다.
