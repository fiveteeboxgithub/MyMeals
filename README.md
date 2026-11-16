# MyMeals
Qu'est-ce qu'on mange ce soir

Planning des repas de la semaine (midi et soir), avec des propositions calculées
à partir de l'historique des repas passés.

## Importer l'historique depuis Google Agenda

1. Sur ordinateur, ouvrir Google Agenda, puis Paramètres.
2. À gauche, cliquer sur l'agenda des repas, puis sur « Exporter l'agenda ».
3. Dézipper le fichier téléchargé : il contient un fichier `.ics`.
4. Dans l'application, cliquer sur « Importer un .ics » et choisir ce fichier.

Les repas restent dans le stockage du navigateur : rien n'est envoyé sur un
serveur, et les fichiers `.ics` sont ignorés par git.

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
