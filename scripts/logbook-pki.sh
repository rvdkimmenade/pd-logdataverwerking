set -eu
cd /pki
umask 077
for name in consumer reader replay; do
  if [ ! -f "$name.crt" ]; then
    openssl req -newkey rsa:2048 -nodes -keyout "$name.key" -out "$name.csr" -subj "/CN=$name" >/dev/null 2>&1
    printf 'extendedKeyUsage=clientAuth\nbasicConstraints=CA:FALSE\n' > client-extensions
    openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -out "$name.crt" -days 30 -extfile client-extensions >/dev/null 2>&1
  fi
done
