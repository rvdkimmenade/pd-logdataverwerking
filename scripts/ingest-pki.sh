set -eu
cd /pki
umask 077
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj /CN=LDV-local-test-CA >/dev/null 2>&1
for name in server source other unknown producer admin; do
  openssl req -newkey rsa:2048 -nodes -keyout "$name.key" -out "$name.csr" -subj "/CN=$name" >/dev/null 2>&1
  printf 'subjectAltName=DNS:localhost,DNS:kafka,DNS:postgres,IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\nbasicConstraints=CA:FALSE\n' > extensions
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -out "$name.crt" -days 30 -extfile extensions >/dev/null 2>&1
done
cat server.key server.crt > broker.pem
cat admin.key admin.crt > admin.pem
chmod 644 *.crt broker.pem admin.pem server.key
printf 'security.protocol=SSL\nssl.keystore.type=PEM\nssl.keystore.location=/pki/admin.pem\nssl.truststore.type=PEM\nssl.truststore.location=/pki/ca.crt\n' > admin.properties
chmod 644 admin.properties
openssl req -x509 -newkey rsa:2048 -nodes -keyout rogue.key -out rogue.crt -days 30 -subj /CN=untrusted >/dev/null 2>&1
