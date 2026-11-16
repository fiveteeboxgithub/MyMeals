# MyMeals
Qu'est-ce qu'on mange ce soir

Planning des repas de la semaine (midi et soir), avec des propositions calculées
à partir de l'historique des repas passés.

## Deux modes

**Avec Google Agenda (recommandé).** Si `VITE_GOOGLE_CLIENT_ID` est renseigné dans
`.env`, l'application demande une connexion Google, lit l'agenda nommé
`VITE_GOOGLE_CALENDAR_NAME` (« Repas ») et y écrit les repas acceptés, modifiés
ou retirés. L'agenda reste la référence ; le navigateur n'en garde qu'une copie
pour afficher le planning tout de suite. Les repas créés depuis l'application
sont placés à 13 h (midi) ou 20 h (soir) et durent une heure.

Pour obtenir l'ID client : dans la console Google Cloud, créer un projet,
activer « Google Calendar API », configurer l'écran de consentement OAuth
(externe, mode Test, avec les comptes du foyer comme utilisateurs de test), puis
créer un ID client OAuth de type « Application Web » avec comme origines
JavaScript autorisées l'adresse du site et `http://localhost:5173`. L'ID client
est public ; le code secret du client n'est pas utilisé.

**Sans Google.** Si `VITE_GOOGLE_CLIENT_ID` est vide, les repas restent dans le
navigateur et l'historique s'importe depuis un export : Google Agenda →
Paramètres → agenda des repas → « Exporter l'agenda », dézipper, puis
« Importer un .ics » dans l'application. Les fichiers `.ics` sont ignorés par git.

## Mise en ligne

Chaque push sur `main` teste, compile et publie le site sur GitHub Pages
(`.github/workflows/deploy.yml`). Dans les réglages du dépôt, « Pages » →
« Source » doit être réglé sur « GitHub Actions ».

## Comment les propositions sont calculées

Chaque titre d'événement est un plat (« Poisson / Purée » et « poisson/purée »
sont regroupés). Pour un créneau donné, un plat est mieux classé s'il a été
mangé souvent, récemment, à la même saison, au même créneau et le même jour de
la semaine ; il est écarté s'il est déjà prévu ou mangé à moins de trois
semaines. Les créneaux rarement remplis sur les 12 derniers mois (par exemple
le midi en semaine) ne reçoivent pas de proposition.

## Développement

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```
