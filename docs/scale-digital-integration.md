# Integration med SCALE Digital

SCALE Digital sparar kontakt- och konsultationsförfrågningar i sin egen databas. SCALE Manager läser dem via den skyddade routen `GET /api/integration/submissions?after=0&limit=100`. En administratör startar importen i Inställningar.

## Konfiguration

- Sätt `Integration__SubmissionsToken` i SCALE Digitals backendmiljö till en slumpmässig nyckel med minst 32 tecken.
- Sätt samma nyckel som `Digital__Token` i SCALE Manager och peka `Digital__BaseUrl` mot SCALE Digitals API-origin.
- Använd HTTPS för båda apparna utanför lokal utveckling. HTTP stöds på loopback under Development. Förvara tjänstenyckeln i en hemlighetshanterare vid driftsättning.

Endpointen stängs om nyckeln saknas. Läsningen är paginerad efter externt ID och svaret kan inte cachas. Ett unikt index i SCALE Manager skyddar mot dubbla importer. Transienta HTTP-fel kan återförsökas. Synkstatus sparas separat från formulärinnehållet. Varje app har en egen databas. En synkning läser högst 10 000 inskickade förfrågningar.

## Upprepa det lokala webbläsartestet

Bygg båda API:erna i WSL med `dotnet build backend` och `dotnet build ../scale-digital/backend`. Scale Manager ska ha tillgång till port 5082 och testinstansen av SCALE Digital till port 5084. Kör sedan `bash tests/run-integration-stack.sh` från projektroten i WSL. Skriptet skapar två separata testdatabaser och en tillfällig nyckel.

Starta SCALE Managers vanliga Vite-server på 5175. Kör `node tests/run-digital-preview.mjs` från roten för att visa SCALE Digitals befintliga frontend på 5176 mot test-API:t. Båda frontendprojekten behöver installerade npm-beroenden.

Kör sedan följande från `frontend` i PowerShell med Playwright Chromium installerat.

```powershell
$env:SCALE_DIGITAL_TEST_URL = 'http://localhost:5176'
npm.cmd run e2e
```

Testet skickar en fiktiv konsultation genom SCALE Digitals formulär, kontrollerar att importen går igenom en gång, och verifierar att en administratör kan konvertera posten och se aktiviteten. Det kontrollerar även att endpointen avvisar anrop utan nyckel och med fel nyckel.

