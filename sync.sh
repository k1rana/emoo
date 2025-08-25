#!/usr/bin/env bash


run_one() {
local line="$1"
IFS=',' read -r -a F <<< "$line"


# Skip empty or commented lines
[[ -z "${F[*]}" || "${F[0]}" =~ ^# ]] && return 0


local shost="${F[$idx_src_host]}"
local suser="${F[$idx_src_user]}"
local spass="${F[$idx_src_pass]}"
local dhost="${F[$idx_dst_host]}"
local duser="${F[$idx_dst_user]}"
local dpass="${F[$idx_dst_pass]}"


local log_file="$LOG_DIR/${suser//[@]/_}__to__${duser//[@]/_}.log"


# Compose flags per row
local FLAGS=("${BASE_FLAGS[@]}")


[[ $idx_src_port -ge 0 && -n "${F[$idx_src_port]:-}" ]] && FLAGS+=(--port1 "${F[$idx_src_port]}")
[[ $idx_dst_port -ge 0 && -n "${F[$idx_dst_port]:-}" ]] && FLAGS+=(--port2 "${F[$idx_dst_port]}")


# SSL: treat "1" or "true" as enabled
to_bool() { [[ "$1" == "1" || "$1" == "true" || "$1" == "TRUE" ]]; }
if [[ $idx_src_ssl -ge 0 && -n "${F[$idx_src_ssl]:-}" ]]; then
if to_bool "${F[$idx_src_ssl]}"; then FLAGS+=(--ssl1); fi
fi
if [[ $idx_dst_ssl -ge 0 && -n "${F[$idx_dst_ssl]:-}" ]]; then
if to_bool "${F[$idx_dst_ssl]}"; then FLAGS+=(--ssl2); fi
fi


[[ $idx_src_auth -ge 0 && -n "${F[$idx_src_auth]:-}" ]] && FLAGS+=(--authmech1 "${F[$idx_src_auth]}")
[[ $idx_dst_auth -ge 0 && -n "${F[$idx_dst_auth]:-}" ]] && FLAGS+=(--authmech2 "${F[$idx_dst_auth]}")


# Common extra options via env COMMON
if [[ -n "$COMMON_OPTS" ]]; then
# shellcheck disable=SC2206
EXTRA=( $COMMON_OPTS )
FLAGS+=("${EXTRA[@]}")
fi


# Choose runner
if [[ "${USE_DOCKER:-0}" == "1" ]]; then
docker run --rm \
-e "IMAPSYNC_DEBUG=0" \
gilleslamiral/imapsync \
imapsync \
--host1 "$shost" --user1 "$suser" --password1 "$spass" \
--host2 "$dhost" --user2 "$duser" --password2 "$dpass" \
"${FLAGS[@]}" \
| tee "$log_file"
else
if ! have_imapsync; then
echo "imapsync not found; switch to Docker by prefixing USE_DOCKER=1" >&2
return 1
fi
imapsync \
--host1 "$shost" --user1 "$suser" --password1 "$spass" \
--host2 "$dhost" --user2 "$duser" --password2 "$dpass" \
"${FLAGS[@]}" \
| tee "$log_file"
fi
}


export -f run_one
export LOG_DIR BASE_FLAGS COMMON_OPTS USE_DOCKER


# Read CSV skipping header and run sequentially or in parallel
mapfile -t LINES < <(tail -n +2 "$CSV_FILE")


if [[ $JOBS -le 1 ]]; then
for L in "${LINES[@]}"; do run_one "$L"; done
else
# Require GNU parallel
if ! command -v parallel >/dev/null 2>&1; then
die "GNU parallel not found. Install it or run with -j 1"
fi
printf '%s\n' "${LINES[@]}" | parallel -j "$JOBS" --will-cite run_one {}
fi