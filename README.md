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

Le bloc « Réglages des propositions » (sous le sélecteur de semaine) comporte trois réglages,
mémorisés sur l'appareil :

- **Hasard** (Aucun, Faible, Moyen, Fort, Très fort, Total ; Fort par défaut) : sans hasard,
  la proposition est toujours la mieux classée ; sinon elle est tirée au sort parmi les 10, 30,
  80, 200 ou toutes les premières, les mieux classées gardant plus de chances (à égalité au niveau
  Total). Un plat mangé ou prévu à moins d'une semaine n'est proposé que s'il n'y a rien d'autre.
  Chaque appui sur ↻ fait un nouveau tirage et ne reproposera jamais un plat déjà écarté pour ce
  créneau. Le même niveau règle le nombre d'idées en lice pour « Surprise Me ».
- **Historique pris en compte** (6 mois, 1 an, 2 ans, 5 ans, 10 ans, toute la période ; 5 ans par
  défaut) : les repas plus anciens sont ignorés, et plus la période est longue, plus les vieux repas
  pèsent dans le classement (la demi-vie suit la période, et l'oubli d'un plat abandonné commence plus tard).
- **Goûts pour « Surprise Me »** (6 mois à 10 ans, ou tout l'historique ; 5 ans par défaut) : période
  sur laquelle sont calculées les familles de plats préférées. Le même réglage se trouve dans la fenêtre de « Surprise Me ».

Les créneaux rarement remplis sur les 12 derniers mois (par exemple le midi en
semaine) ne reçoivent pas de proposition.

## Surprise Me

Dans la fenêtre d'un créneau, le bouton « Surprise Me » propose un plat qui
n'apparaît nulle part dans l'historique. Les idées viennent d'un catalogue
intégré (`src/lib/catalog.ts`), où chaque plat est décrit par des familles
(poisson, riz, gratins…). Elles sont classées selon la part de ces familles dans
les repas de la période choisie (6 mois à tout l'historique, 5 ans par défaut) et selon la
saison, puis tirées au sort parmi les mieux classées : le niveau de hasard règle combien d'idées
sont en lice (voir « Réglages des propositions »).

## Page « Doublons »

**Doublons suspectés (affichés en premier).** L'application repère elle-même les libellés qui
désignent probablement le même plat : mêmes mots à une majuscule, un accent, un pluriel, l'ordre
des mots ou une faute d'une lettre près (le regroupement est celui des propositions de repas,
voir plus haut). Chaque groupe est une carte avec ses libellés (nombre de repas, dernier repas),
ce qui les distingue (« majuscules ou accents », « singulier ou pluriel », « ordre des mots »,
« faute de frappe probable »), le nom retenu (le libellé le plus utilisé, écrit avec la même
première lettre que le reste du calendrier ; modifiable) et deux boutons : « Confirmer » renomme
tous les repas du groupe, « Pas des doublons » écarte le groupe (mémorisé sur l'appareil, avec un
lien pour réafficher les écartés). « Tout confirmer » fusionne tous les groupes après une
confirmation. Les groupes les plus lourds viennent en premier, vingt à la fois.

**Recherche manuelle.** L'onglet « Doublons » cherche dans tout le calendrier les repas dont le libellé
contient **tous** les mots saisis, chacun pouvant n'être que le début d'un mot :
« pat jacqu » trouve « st jacques aux pâtes » et « pâte à la saint jacques », mais
ni « pâtes au pesto » ni « pat carbo ». L'ordre des mots, les accents et les
majuscules ne comptent pas, et les autres noms d'un même ingrédient sont reconnus
(« st jacques » trouve aussi « coquilles » ; « pdt » trouve « pommes de terre »). 
L'option « Expression régulière » (avec une infobulle d'exemples, bouton « ? ») traite le
texte saisi comme un motif, par exemple `^pates`, `riz|quinoa`, `pat.*jacqu` ou
`^(?!.*sauce).*pates`. Les accents et les majuscules sont ignorés ; un motif invalide
affiche un message et ne cherche rien. Chaque libellé distinct est affiché avec le nombre de repas
qui le portent et une case à cocher. « Fusionner » propose un nom commun (le libellé
coché le plus utilisé, modifiable) puis, après confirmation, renomme tous les repas
cochés. Avec Google Agenda, ce sont les événements de l'agenda qui sont renommés ;
ceux qui échouent gardent leur nom.

## Affichage

- **Repas affichés** : un sélecteur « Midi / Soir / Les deux » (« Soir » par défaut)
  choisit les créneaux montrés dans le planning. Seuls les créneaux affichés reçoivent
  des propositions ; les repas déjà prévus comptent toujours pour la variété de la semaine.
- **Couleur de fond** : le bouton 🎨 de l'en-tête propose dix thèmes (Auto, Crème, Blanc,
  Menthe, Ciel, Rose, Sable, Ardoise, Nuit, Minuit) et une couleur libre. Le texte, les
  cartes et les boutons s'adaptent pour rester lisibles (contraste d'au moins 4,5:1, vérifié
  par les tests). « Auto » suit le mode clair ou sombre de l'appareil.

Les deux réglages sont mémorisés sur l'appareil.

## Connexion Google

Une connexion Google dans un navigateur dure une heure. À l'expiration, le premier toucher
sur l'écran la renouvelle (la fenêtre Google s'ouvre et se referme seule quand le compte est
connu) ; une action d'écriture (✓, renommage) renouvelle aussi la connexion avant de s'exécuter.
Un refus 403 « trop de requêtes » est réessayé avec une attente progressive au lieu de
déconnecter ; seul un refus 401 ou des autorisations insuffisantes déconnecte. « Se déconnecter »
arrête la reconnexion automatique.

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
