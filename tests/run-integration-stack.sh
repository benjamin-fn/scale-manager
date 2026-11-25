#!/usr/bin/env bash
set -euo pipefail

# Run from WSL. The existing SCALE Digital processes and database are independent.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
root="$PWD"
dotnet_bin="${SCALE_DOTNET:-$(command -v dotnet || true)}"
if [[ -z "$dotnet_bin" ]]; then dotnet_bin="$HOME/.dotnet/dotnet"; fi

digital_port=5084
manager_port=5082
for port in "$digital_port" "$manager_port"; do
    if ss -Hltn "sport = :$port" | grep -q .; then
        printf 'Port %s is already in use.\n' "$port" >&2
        exit 1
    fi
done

secret="$(openssl rand -hex 32)"
digital_db="$(mktemp "$root/tests/digital-integration-XXXXXX.db")"
manager_db="${SCALE_MANAGER_DB:-$(mktemp "$root/tests/manager-integration-XXXXXX.db")}"
manager_db="$(realpath -m -- "$manager_db")"

(
    cd "$root/../scale-digital/backend"
    export ASPNETCORE_ENVIRONMENT=Development
    export ConnectionStrings__Leads="Data Source=$digital_db"
    export Integration__SubmissionsToken="$secret"
    exec "$dotnet_bin" bin/Debug/net10.0/ScaleDigital.dll --urls "http://127.0.0.1:$digital_port"
) &
digital_pid=$!
(
    cd "$root/backend"
    export ASPNETCORE_ENVIRONMENT=Development
    export ConnectionStrings__Manager="Data Source=$manager_db;Foreign Keys=True"
    export Digital__BaseUrl="http://127.0.0.1:$digital_port"
    export Digital__Token="$secret"
    exec "$dotnet_bin" bin/Debug/net10.0/ScaleManager.dll --urls "http://127.0.0.1:$manager_port"
) &
manager_pid=$!
trap 'kill "$digital_pid" "$manager_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
wait -n "$digital_pid" "$manager_pid"

