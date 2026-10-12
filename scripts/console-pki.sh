set -eu
cd /pki
umask 077
for name in console-server identityprovider console-ops; do
  if [ ! -f "$name.crt" ]; then
    openssl req -newkey rsa:2048 -nodes -keyout "$name.key" -out "$name.csr" -subj "/CN=$name" >/dev/null 2>&1
    printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\nbasicConstraints=CA:FALSE\n' > console-extensions
    openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -out "$name.crt" -days 30 -extfile console-extensions >/dev/null 2>&1
  fi
done
