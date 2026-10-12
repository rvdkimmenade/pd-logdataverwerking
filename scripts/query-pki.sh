set -eu
cd /pki
umask 077
for name in search-node search-admin projector query-index query-server auditor auditor-other auditor-app denied; do
  if [ ! -f "$name.crt" ]; then
    openssl req -newkey rsa:2048 -nodes -keyout "$name.key" -out "$name.csr" -subj "/CN=$name" >/dev/null 2>&1
    printf 'subjectAltName=DNS:localhost,DNS:opensearch,IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\nbasicConstraints=CA:FALSE\n' > query-extensions
    openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -out "$name.crt" -days 30 -extfile query-extensions >/dev/null 2>&1
  fi
done
