# Déployer sur Render — essai gratuit

Le projet est préparé, mais aucun fichier n’a été poussé sur GitHub et aucun service Render n’a été créé.

## 1. Publier le code sur ton GitHub

Utilise ton propre dépôt. Le remote `origin` actuel pointe vers `https://github.com/vublich/wa-bot.git` : change-le avant de pousser.

Depuis PowerShell, dans ce dossier (remplace `TON_COMPTE` et `TON_DEPOT`) :

```powershell
git remote set-url origin https://github.com/TON_COMPTE/TON_DEPOT.git
git add .gitignore README.md DEPLOY_RENDER.md .env.example .node-version render.yaml package.json package-lock.json index.js server.js storage.js public tests
git diff --cached --stat
git commit -m "Add web dashboard and Render deployment configuration"
git push -u origin main
```

Si ton dépôt distant contient déjà une autre histoire, ne force pas le push : traite le conflit avant de continuer.

Les dossiers `auth/`, `auth-backup*/`, les logs et `config.json` sont ignorés : ils contiennent des données de session ou de configuration et ne font pas partie du déploiement. Sur Render, connecte WhatsApp avec un nouveau QR code. Arrête le bot local avec Ctrl+C si tu veux utiliser seulement la version hébergée.

## 2. Créer le service Render

Connecte-toi à <https://dashboard.render.com>, puis **New → Web Service** et sélectionne ton dépôt GitHub.

| Champ | Valeur |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Root Directory | laisser vide |
| Build Command | `npm ci && npm run check && npm test` |
| Start Command | `npm start` |
| Instance Type | **Free** |
| Health Check Path | `/health` |

La version de Node est fixée à la famille 22 dans `.node-version`.

Dans **Environment**, ajoute **`ADMIN_PASSWORD`** avec un mot de passe long et unique. Ce mot de passe protège l’interface. Ne le mets pas dans GitHub. Tu peux aussi ajouter `MY_NUMBER` avec ton numéro international, sans `+` ni espace ; sinon configure-le dans l’interface après déploiement.

Clique sur **Deploy Web Service**. Une fois le déploiement terminé, ouvre l’URL `https://…onrender.com` affichée par Render.

Le navigateur demande des identifiants : **utilisateur `admin`**, mot de passe égal à `ADMIN_PASSWORD`. Scanne ensuite le QR depuis WhatsApp → Appareils connectés → Connecter un appareil et enregistre le numéro destinataire.

Render fournit automatiquement `PORT` et `RENDER_EXTERNAL_URL`. Le serveur utilise cette dernière pour accepter les changements de configuration depuis l’URL publique. Si tu ajoutes un domaine personnalisé, configure `PUBLIC_ORIGIN` avec son origine exacte, par exemple `https://bot.example.com`.

### Alternative : Blueprint

Tu peux utiliser **New → Blueprint** avec le même dépôt : `render.yaml` déclare le service gratuit et ses commandes. Render demandera la valeur de `ADMIN_PASSWORD` au moment de la création.

## Limites de l’essai gratuit

Render peut mettre le service en veille après 15 minutes sans trafic entrant. Les fichiers locaux, dont la session WhatsApp et la configuration du destinataire, sont perdus aux redémarrages, redéploiements et mises en veille. Il faudra alors rescanner un QR code et reconfigurer le numéro, sauf si `MY_NUMBER` est défini dans les variables Render. Cet essai ne garantit pas un bot connecté en continu.

Source : <https://render.com/docs/free>.

## Dépannage

- **Déploiement refusé avec `ADMIN_PASSWORD est obligatoire`** : ajoute la variable dans Environment et redéploie.
- **Connexion WhatsApp fermée avec 401** : la session a été déconnectée. Sur cet essai gratuit, un redéploiement démarre avec un nouveau dossier de session, permettant de rescanner un QR code.
- **Erreur 403 lors de l’enregistrement du numéro** : vérifie l’URL publique ; pour un domaine personnalisé, ajoute `PUBLIC_ORIGIN`.
- **Erreur 408 côté WhatsApp** : consulte les logs Render ; le bot tente de se reconnecter. Le déploiement HTTP peut être sain alors que WhatsApp est déconnecté.

## Passage ultérieur à un disque persistant

Sur un service payant, tu peux monter un disque à `/var/data` et définir `DATA_DIR=/var/data`. La session, le numéro enregistré et les logs seront alors écrits dans ce dossier. Aucun disque ni service payant n’est configuré pour cet essai.

Source : <https://render.com/docs/disks>.
