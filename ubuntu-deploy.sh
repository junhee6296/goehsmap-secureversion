#!/bin/bash
set -Eeuo pipefail

# 이전 파일명을 사용하던 서버를 위한 호환용 실행기입니다.
# 실제 배포는 단순화된 goehsschoolmap.sh가 담당합니다.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/goehsschoolmap.sh" "$@"
