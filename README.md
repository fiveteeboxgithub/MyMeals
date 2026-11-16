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

Chaque titre d'événement est un plat. Deux titres sont le même plat s'ils ont
les mêmes mots importants, quels que soient l'ordre, les majuscules, les accents,
les pluriels, la ponctuation et les petits mots (« aux », « de », « maison »).
Les façons courantes de nommer un même ingrédient sont unifiées (« coquilles »,
« st jacques » et « noix de Saint-Jacques » ; « pdt » et « pommes de terre » ;
« mac do » et « McDonald's » ; la liste est dans `PHRASES`, `src/lib/suggest.ts`),
et une faute d'une lettre est tolérée (« kebbab »). L'écriture la plus utilisée
est affichée ; les autres apparaissent sous « aussi écrit ».

Pour un créneau donné, un plat est mieux classé s'il a été mangé souvent,
récemment, à la même saison, au même créneau et le même jour de la semaine.
Il est moins bien classé :

- s'il revient plus tôt que son rythme habituel (un plat hebdomadaire peut
  revenir au bout de deux semaines, un plat rare attend jusqu'à trois mois) ;
- s'il n'a plus été mangé depuis plus d'un an ;
- si la semaine contient déjà un plat avec le même ingrédient.

Le réglage « Hasard des propositions » décide comment ce classement est utilisé :
sans hasard, la proposition est toujours la mieux classée ; sinon elle est tirée
au sort parmi les 10, 30 ou 80 premières, les mieux classées gardant plus de
chances. Le bouton ↻ écarte la proposition et en tire une autre, sans jamais
reproposer un plat déjà écarté pour ce créneau.

Les créneaux rarement remplis sur les 12 derniers mois (par exemple le midi en
semaine) ne reçoivent pas de proposition.

## Surprise Me

Dans la fenêtre d'un créneau, le bouton « Surprise Me » propose un plat qui
n'apparaît nulle part dans l'historique. Les idées viennent d'un catalogue
intégré (`src/lib/catalog.ts`), où chaque plat est décrit par des familles
(poisson, riz, gratins…). Elles sont classées selon la part de ces familles dans
les repas de la période choisie (6 mois à 5 ans, 2 ans par défaut) et selon la
saison, puis tirées au sort parmi les dix meilleures.

## Page « Doublons »

L'onglet « Doublons » cherche dans tout le calendrier les repas dont le libellé
contient **tous** les mots saisis, chacun pouvant n'être que le début d'un mot :
« pat jacqu » trouve « st jacques aux pâtes » et « pâte à la saint jacques », mais
ni « pâtes au pesto » ni « pat carbo ». L'ordre des mots, les accents et les
majuscules ne comptent pas, et les autres noms d'un même ingrédient sont reconnus
(« st jacques » trouve aussi « coquilles » ; « pdt » trouve « pommes de terre »). Chaque libellé distinct est affiché avec le nombre de repas
qui le portent et une case à cocher. « Fusionner » propose un nom commun (le libellé
coché le plus utilisé, modifiable) puis, après confirmation, renomme tous les repas
cochés. Avec Google Agenda, ce sont les événements de l'agenda qui sont renommés ;
ceux qui échouent gardent leur nom.

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
