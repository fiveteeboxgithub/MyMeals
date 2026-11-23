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

La section « Propositions » de l'onglet **Réglages** comporte trois réglages,
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
sont en lice (voir la section « Propositions » des réglages).

## Liste noire

Pour les plats que tu ne veux pas voir proposés (noms de restos, plats de restaurant ou à emporter),
l'onglet **Réglages** contient une **liste noire** : une entrée par ligne.

- Un mot ou une expression (`kebab`, `chez paul`) : tous les plats dont le nom **contient** ce texte sont
  cachés, sans tenir compte des majuscules ni des accents (« kebab » cache aussi « Kebabs frites »).
  Les différentes écritures d'un même plat comptent : si « kebab » et « kebbab » sont regroupés, l'une ou
  l'autre suffit.
- Une ligne entourée de barres obliques est une **expression régulière** : `/\bpho\b/` (le mot « pho »,
  pas « photo »), `/^(sushi|maki)/`. Une expression mal formée est signalée et ignorée.
- Les lignes vides et celles qui commencent par `#` sont ignorées.

**Ajouter un plat d'un geste** : « 🚫 Liste noire » dans la fiche d'un plat (fenêtre du créneau, pour un repas prévu comme pour la proposition ; « Sur la liste noire (retirer) » l'en retire),
ajoute son nom à la liste noire, retire aussitôt la proposition et affiche un message avec « Annuler ». Le
message indique combien de plats sont masqués si la ligne en touche plusieurs (« kebab » masque aussi
« kebab frites ») ; on peut ensuite affiner la ligne dans les réglages.

Les plats concernés ne sont **jamais** proposés dans le planning, ni dans la liste de la fenêtre d'un
créneau, ni par « Surprise Me » (les idées du catalogue dont le nom correspond sont retirées), et leurs
repas ne comptent plus dans le calcul de tes goûts. Ils reviennent seulement si :

- tu actives **« Inclure la liste noire (rarement) »** : environ une proposition sur dix vient alors de la
  liste, les neuf autres jamais ;
- tu choisis « Un plat de la liste noire » dans le menu **⋯** d'une proposition (visible quand la liste
  concerne au moins un plat de ton historique) : un autre à chaque fois ;
- tu ouvres la fenêtre d'un créneau et choisis « Afficher aussi les plats de la liste noire », ou tu
  cherches un nom précis (ils portent alors l'étiquette « liste noire »).

La liste et l'option font partie des **réglages partagés** (voir plus bas).

## Favoris

L'inverse de la liste noire : les plats favoris comptent **deux fois et demie** plus dans les propositions
(ils restent soumis au délai entre deux fois et à la variété de la semaine). On les ajoute d'un geste :

- l'étoile ☆ à côté d'un repas prévu ou de la proposition, dans la fenêtre d'un créneau ;
- « Ajouter aux favoris » dans le menu **⋯** d'une proposition.

Dans **Réglages → Favoris**, la liste s'écrit comme la liste noire (un mot par ligne, qui retient tout plat
le contenant, ou `/motif/`). Une proposition favorite porte la mention « ⭐ favori ». Si un plat est favori
par une règle plus large (« pâtes »), l'étoile ne peut pas l'en retirer : il faut modifier la règle. Si un
plat est à la fois favori et sur la liste noire, la liste noire l'emporte. Les favoris font partie des
réglages partagés (800 caractères au plus).

## Notes sur les repas

Chaque repas peut porter une note : un lien de recette, « trop salé », « les enfants ont adoré ». C'est la
**description de l'événement** dans Google Agenda : elle s'y voit, et une description écrite depuis Google
Agenda apparaît dans l'application (le HTML de Google est converti en texte, les liens restent cliquables).

- Dans la fenêtre d'un créneau : « 📝 Ajouter une note », ou « Modifier ». Une note vide retire la description.
- Sous le repas apparaissent les **notes des fois précédentes** du même plat (toutes ses écritures), les plus
  récentes d'abord ; elles s'affichent aussi sous une proposition, avant de la choisir.
- Dans le planning, un 📝 signale un repas qui a une note.

La première synchronisation après cette mise à jour relit tout l'agenda une fois, pour récupérer les
descriptions existantes.

## Images des plats

À côté des plats prévus et proposés, une petite photo trouvée sur **Wikipédia en français** (images libres de
Wikimedia Commons), sans aucune IA ni clé d'API : l'application cherche l'article du même nom que le plat, sinon
les premiers résultats de recherche dont le titre partage un mot avec le plat, en écartant les pages d'homonymie.
Pour un plat composé, seule la première partie est cherchée (« agneau/pates » → « agneau ») ; « restes de X »
cherche « X ». Si Wikipédia ne trouve rien, l'application cherche une photo sous licence libre sur
**Openverse** (moteur public de la fondation WordPress, qui rassemble notamment des photos Flickr), dont le titre
ou les mots-clés partagent un mot avec le plat ; l'auteur et la licence sont indiqués. Pas de résultat fiable :
pas d'image.

**Choisir une image** : dans la fenêtre d'un créneau, « 🖼️ Choisir une image » accepte l'adresse d'une image
(https uniquement ; sur une photo, « Copier l'adresse de l'image »). Elle passe avant toute recherche, pour le plat
et toutes ses variantes de même début (« quiche lorraine/salade » et « quiche lorraine »). Ces images sont
partagées entre les appareils par un second événement spécial de l'agenda, « 🖼 MyMeals : images des plats (ne pas
supprimer) », le 2 janvier 2100 (une quarantaine d'images y tiennent) ; sans Google, elles restent dans le
navigateur.

- Un plat sans image garde une case vide à la place de la vignette : le texte des plats reste aligné d'une ligne à
  l'autre, en vue liste comme en colonnes.
- Chaque plat n'est cherché qu'une fois puis gardé sur l'appareil (un plat sans image est recherché à nouveau au
  bout d'un mois), deux recherches à la fois au plus. Seul le nom du plat est envoyé à Wikipédia.
- Dans la fenêtre d'un créneau, l'image est plus grande, avec un lien vers l'article (source et licence) et
  « Pas la bonne image », qui la retire pour ce plat sur cet appareil.
- **Réglages → Planning → Images des plats** les désactive (aucune requête n'est alors faite) ; on y rétablit
  aussi les images écartées. Ce réglage est propre à chaque appareil.

## Connexion expirée

Le jeton Google dure une heure. Quand il expire, l'appli propose « Reconnecter » (ou se renouvelle au premier
toucher) ; l'avertissement « La connexion Google a expiré… » disparaît tout seul dès qu'on est reconnecté et que
l'agenda est synchronisé. Les autres erreurs (un repas qui n'a pas pu être renommé, par exemple) restent affichées
jusqu'à ce qu'on les ferme.

## Réglages partagés

Avec Google Agenda, les réglages qui décrivent tes goûts sont enregistrés dans l'agenda lui-même, pour être
retrouvés sur tous les appareils et par le foyer : la liste noire et son option, les favoris, les créneaux « Pas de repas », le niveau de hasard,
l'historique pris en compte, la période des goûts de « Surprise Me », « Mes idées » et les heures des
repas. Ils vivent dans un **événement
spécial** de l'agenda « Repas » : « ⚙ MyMeals : réglages (ne pas supprimer) », une journée entière le
1er janvier 2100, privée et sans rappel, d'identifiant fixe (`mmealsreglages00`). Son texte contient une phrase
d'explication puis les réglages en JSON. L'application ne le compte jamais comme un repas.
Pour tenir dans ce texte (environ 8 000 caractères chez Google), la liste noire est limitée à
2 500 caractères, les favoris à 800 et « Mes idées » à 3 500 ; un enregistrement trop long est refusé avec un message, et les
réglages restent sur l'appareil.

- Un réglage modifié est envoyé à l'agenda environ une seconde après la dernière frappe.
- Chaque appareil garde aussi une copie locale (`localStorage`) : l'application marche hors connexion.
- Quand deux appareils diffèrent, **le plus récent l'emporte** (date de dernière modification) : un appareil neuf
  reprend les réglages de l'agenda ; des réglages faits avant la synchronisation sont envoyés s'il n'y en a pas
  encore dans l'agenda.
- Les réglages d'affichage restent propres à chaque appareil : couleur de fond, Midi/Soir/Les deux, « À décider
  seulement », vue colonnes ou liste, images des plats, autres agendas affichés, groupes de doublons écartés.
- Sans connexion Google (mode import de fichier), tout reste local ; le texte de la liste noire se copie-colle.

Supprimer l'événement dans Google Agenda remet les réglages de l'agenda à zéro : le premier appareil qui se
connecte ensuite le recrée avec ses propres réglages.

## Dans la fiche d'un créneau

Le nom du plat en titre, l'étoile des favoris à droite, l'image avec sa source, puis des boutons-pastilles à icône
(les actions qui détruisent ou excluent sont en rouge).

- **Repas prévu** : *Autre plat* (le remplace par un plat tiré au hasard : jamais déjà prévu cette semaine ni déjà
  tiré pour ce créneau, avec « Annuler » ; on peut appuyer plusieurs fois), *Déplacer*, *Renommer* (renomme
  l'événement de l'agenda), *Ajouter / Modifier la note*, *Liste noire*, *Retirer*. La note reste en place quand le
  plat change.
- **Proposition** : *Choisir ce plat*, *Autre proposition* (comme ↻ sur la ligne du planning ; la ligne derrière
  suit), *Modifier le nom* (puis « Choisir » ou Entrée prévoit le plat sous ce nom), *Autre créneau*, *Liste noire*.
- **Créneau vide** : *Pas de repas ce midi / ce soir*.

Les messages avec « Annuler » sont un bandeau fixe en haut de l'écran : ils restent atteignables même quand une
fenêtre est ouverte.

## Fridge memo

Un pense-bête partagé, comme les post-it sur un frigo : envies de plats, restes du frigo à finir, courses… en texte
libre. Le bouton **Fridge memo** (en haut de chaque page, avec le nombre de mémos) ouvre une fenêtre : un champ pour
écrire, puis les mémos en post-it, du plus récent au plus ancien, avec leur auteur et leur date.

- **Chacun peut supprimer n'importe quel mémo**, y compris ceux des autres (poubelle sur le post-it ; « Annuler »
  le remet), et **le modifier** (crayon : le texte devient un champ, Entrée ou « Enregistrer » valide, Échap annule ;
  l'auteur et la date d'origine sont gardés, seule la propriété de ce mémo est réécrite).
- **Position** : Réglages → Fridge memo → « En haut de l'écran » ou « En bas de l'écran » (par défaut) : la fenêtre
  s'ouvre collée en haut ou en bas de l'écran. Réglage propre à cet appareil.
- **Jamais un plat** : les mémos ne servent ni aux propositions, ni à l'historique, ni à « Surprise Me », ni aux
  statistiques, ni à la liste des plats d'un créneau. On ne peut pas non plus en faire un repas.
- **Où c'est stocké** : dans un événement spécial de l'agenda « Repas », « 🧲 MyMeals : fridge memo (ne pas
  supprimer) », une journée entière le 3 janvier 2100 (identifiant `mmealsfridge00`), comme les réglages et les
  images ; l'application ne le compte jamais comme un repas. Chaque mémo est **une propriété partagée** de cet événement
  (`mmmemo_…`) : ajouter ou supprimer un mémo ne touche que sa propriété, donc deux personnes qui écrivent en même
  temps ne perdent rien (les mémos se fusionnent un par un). Supprimer l'événement dans Google Agenda efface tous les
  mémos.
- **Limites** : 200 caractères par mémo, 40 mémos au plus et environ 6 500 caractères en tout, pour tenir dans un
  événement Google ; au-delà, l'appli demande de supprimer quelques mémos. Un mémo supprimé libère sa propriété, qui
  est réutilisée quand il y en a beaucoup (Google limite le nombre de propriétés d'un événement).
- **Sans connexion Google** (mode import de fichier) : les mémos restent dans le navigateur, comme les repas.
- Les mémos se mettent à jour comme le reste de l'agenda : au retour sur la fenêtre et toutes les trois minutes.

## Aimer un plat (à plusieurs)

Quand plusieurs personnes partagent l'agenda « Repas », chacune connectée avec son compte Google, on voit qui a
choisi un plat et qui l'aime.

- **Qui a choisi** : celui qui a créé l'événement (Google Agenda le sait, même pour un plat saisi dans Google Agenda),
  ou celui qui a changé le plat depuis l'application. Celui-là n'a pas de bouton « J'aime » pour son propre plat.
- **J'aime** : sur la ligne du créneau, un petit cœur discret (gris et vide : tu peux aimer ; plein : quelqu'un
  l'aime) ; dans la fiche, le bouton « J'aime » / « Je n'aime plus » et la phrase « Choisi par X · Aimé par Y ». Celui
  qui a choisi le plat voit le cœur plein dès qu'un autre l'aime. Sur un créneau qui a plusieurs repas, le cœur de la
  ligne montre seulement qu'un plat est aimé ; on aime chaque repas dans la fiche.
- **Pas dans le passé** : un créneau dont le jour est passé ne propose plus d'aimer (ni cœur cliquable, ni bouton) ;
  les « J'aime » déjà donnés y restent visibles.
- **Retirer** : la personne reclique. **Tous les « J'aime » tombent** quand le plat change (remplacé, « Autre plat »,
  choisi ailleurs) ou quand le repas est déplacé vers un autre créneau ; un repas retiré n'existe plus. Renommer un
  plat (faute de frappe, fusion de doublons) garde les « J'aime ».
- **Où c'est stocké** : dans les propriétés partagées de l'événement Google lui-même (aucun serveur) : une propriété
  par personne (`mmlike_…`, valeur : son adresse Google), donc deux personnes qui aiment en même temps ne
  s'écrasent pas, et `mmby` pour qui a choisi le plat. Ces adresses sont visibles de toutes les personnes qui ont accès
  à l'agenda ; les noms affichés sont tirés des adresses (« marie.dupont@… » → « Marie Dupont »).
- Il faut être connecté avec Google ; sans connexion (import de fichier), aucune de ces fonctions n'apparaît. La
  première synchronisation après la mise à jour relit tout l'agenda une fois.

## Jours passés

Dans un jour passé, un créneau sans repas n'est pas affiché du tout (ni « + Ajouter », ni les événements des autres
agendas) ; un jour passé sans aucun repas disparaît lui aussi de la semaine. Les créneaux d'aujourd'hui et à
venir s'affichent toujours.

## Changer de semaine

Les flèches ‹ ›, « Aujourd'hui » et le geste de balayage changent de semaine avec un effet de glissement : la
semaine affichée part d'un côté, la nouvelle arrive de l'autre (vers la gauche pour la suivante, vers la droite
pour la précédente). Sur téléphone, la semaine **suit le doigt** pendant le balayage ; relâchée au-delà de 70 px,
on change de semaine, sinon elle revient en place. Un défilement vertical ne change jamais de semaine. Avec
« réduire les animations » activé dans le système, le changement est immédiat.

**Semaine courante en liste verticale** (téléphone, ou « Vue liste » sur ordinateur) : l'appli descend d'elle-même
jusqu'au jour d'aujourd'hui, une fois par semaine affichée et seulement si tu n'as pas déjà fait défiler la page.

**Fenêtres ouvertes** (fiche d'un créneau, choix d'un créneau) : la page derrière est figée ; glisser dans la
fenêtre ne fait plus défiler la semaine du dessous, et la position est retrouvée à la fermeture. La fenêtre elle-même
défile en entier (titre fixe en haut, avec le bouton de fermeture) : la liste des plats s'étale au lieu de se réduire
à une ligne.

La semaine affichée est gardée pour la session du navigateur : après un rechargement de la page (ou un détour par
Réglages, Stats…), on retrouve la même semaine ; un nouvel onglet ou une nouvelle ouverture de l'application repart de
la semaine d'aujourd'hui, comme le bouton « Aujourd'hui ».

## Accepter ailleurs, déplacer un repas

- **Accepter pour un autre créneau** : dans le menu **⋯** d'une proposition (ou sous la proposition, dans la
  fenêtre du créneau), « 📅 Accepter pour un autre créneau… » ouvre le choix d'un créneau.
- **Déplacer un repas prévu** : dans la fenêtre du créneau, « 📅 Déplacer » à côté du repas. Le même événement
  Google change de date et d'heure (sa note le suit) ; le créneau d'origine se vide.

Le choix d'un créneau montre les quatorze jours à partir d'aujourd'hui (jamais avant), chacun avec Midi et Soir
et ce qui y est déjà prévu (« libre » en surbrillance) ; « Autre date » ouvre un calendrier pour aller plus loin.
Un créneau déjà pris garde son plat : le nouveau s'y ajoute. Chaque action propose « Annuler ».

## Plusieurs repas sur un même créneau

Deux événements le même jour à la même heure (ou, plus généralement, du même côté de 16 h) tombent dans le
même créneau, affiché « pizza + salade ». Le créneau compte comme décidé. Dans sa fenêtre, chaque repas a
son propre bouton « Retirer » (et « Tout retirer »). Quand le créneau a déjà un repas, un choix apparaît
au-dessus de la recherche : **Remplacer** (par défaut : le plat choisi renomme le premier repas du créneau et
laisse les autres) ou **+ Ajouter un plat** (le plat choisi crée un événement de plus, à la même heure, avec
« Annuler »). C'est la même règle avec Google Agenda et avec l'import de fichier.

## Page « Doublons »

**Doublons suspectés (affichés en premier).** L'application repère elle-même les libellés qui
désignent probablement le même plat : mêmes mots à une majuscule, un accent, un pluriel, l'ordre
des mots ou une faute d'une lettre près (le regroupement est celui des propositions de repas,
voir plus haut). Chaque groupe est une carte avec ses libellés, **tous cochés d'avance** (nombre de repas, dernier repas ;
« Tout cocher » / « Tout décocher » par carte) : on décoche ce qui n'est pas le même plat, et seuls les
libellés cochés sont renommés, y compris avec « Tout confirmer ». La carte indique ce qui les distingue (« majuscules ou accents », « singulier ou pluriel », « ordre des mots »,
« faute de frappe probable »), le nom retenu (le libellé le plus utilisé, écrit avec la même
première lettre que le reste du calendrier ; modifiable) et deux boutons : « Confirmer » renomme
tous les repas du groupe, « Pas des doublons » écarte le groupe (mémorisé sur l'appareil, avec un
lien pour réafficher les écartés). « Tout confirmer » fusionne tous les groupes après une
confirmation. Les groupes les plus lourds viennent en premier, vingt à la fois.

**Approchants.** Un second onglet propose les plats dont les mots sont **inclus** dans ceux d'un plat plus
détaillé : « pâtes saumon » et « pâtes saumon fumé ». Le plat de base a au moins deux mots et le plat détaillé
un ou deux de plus (trois mots en plus, c'est trop loin) ; chaque plat détaillé est rangé sous le plat de base
le plus proche, et les « restes » sont écartés. Comme c'est moins sûr que de simples variantes d'écriture, rien
n'est coché d'avance : on coche les plats qui sont bien le même, le nom retenu se propose, puis « Fusionner ».
Les plats qui ne diffèrent que par un mot d'habillage (« fumé », « frais », « grillé »…) sont marqués
« probable » et passent en premier. « Pas des doublons » écarte la carte (mémorisé sur l'appareil).

**Le pied de page** affiche trois chiffres : les repas, les **libellés** (écritures exactes différentes, ce que les
fusions font baisser) et les **plats** (après le regroupement automatique des majuscules, pluriels, accents et
ordre des mots : fusionner de simples variantes ne change donc pas ce dernier chiffre).

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


**Fusionner puis mettre en liste noire** : chaque fusion (Suspectés, Approchants, Recherche) a une case « Ensuite,
mettre « nom » en liste noire ». Une fois les repas renommés (et seulement si aucun n'a échoué), le nom retenu est
ajouté à la liste noire : ce plat, avec ses variantes, ne sera plus proposé. Les repas restent dans l'agenda. Dans
« Suspectés », « Tout confirmer » a la même case pour tous les groupes ; un groupe déjà au bon nom peut être mis
en liste noire sans rien renommer. La liste noire cache tout plat dont le nom contient le texte ajouté.
## Organisation de l'application

Quatre onglets : **Planning**, **Doublons**, **Stats** et **Réglages**. L'en-tête n'affiche un bouton que
lorsqu'il faut agir (se connecter, importer un fichier). Sur un écran large, la semaine s'affiche en sept
colonnes, dont les rangées sont alignées (tous les midis, puis tous les soirs, à la même hauteur ; images,
noms et événements des autres agendas aussi). Le bouton « ☰ Vue liste » (ou Réglages → Planning) affiche
à la place la semaine en liste verticale, comme sur téléphone ; ce choix est propre à chaque appareil.

### Planning

- **Changer de semaine** : flèches, balayage gauche/droite sur téléphone, bouton « Aujourd'hui ».
- **Une proposition** a quatre boutons : **↻** (une autre), **∅** (pas besoin de repas ce midi / ce soir : seulement
  ce créneau, avec « Annuler »), **⋯** et **✓** (accepter). Le menu **⋯** regroupe le reste, avec un libellé :
  « Surprise Me » (un plat jamais noté, catalogue ou « Mes idées »), « Un plat oublié » (mangé au moins quatre
  fois, plus depuis un an), « Un plat de la liste noire », favoris, « Accepter pour un autre créneau… ». Pour
  ne plus jamais proposer un plat, on touche la proposition et on utilise « 🚫 Liste noire » dans sa fiche ;
  sur ordinateur, les boutons sont alignés d'un jour à l'autre.
- **Restes** : l'application apprend quels plats laissent des restes (au moins deux repas « restes <plat> »
  dans les trois jours qui suivent ce plat). Quand un tel plat est prévu, le créneau suivant (parmi les
  trois suivants) propose ses restes ; ce n'est qu'une proposition, ↻ en donne une autre.
- **Accepter** affiche un message avec « Annuler ». « ✓ Tout accepter » remplit d'un coup les créneaux à
  venir qui ont une proposition (et s'annule de même). « Partager la semaine » ouvre le partage du téléphone,
  ou copie la semaine en texte.
- **Autres agendas** : les événements à heure fixe de tes autres agendas Google qui tombent pendant un repas
  (d'une heure avant jusqu'à deux heures après le midi, deux heures et demie après le soir) s'affichent sous le
  créneau, en lecture seule, à titre d'information. Rien n'est décidé ni modifié pour toi. Les événements
  « journée entière » sont ignorés. Les agendas affichés se choisissent dans les réglages (par défaut : ceux
  cochés dans Google Agenda, sans les numéros de semaine ni le lever et coucher du soleil).
- **Fenêtre d'un créneau** : la proposition en cours en tête (avec « ✓ Choisir »), les événements des autres
  agendas, la recherche d'un plat ; Échap la ferme.
- Au premier chargement sur un appareil, « Chargement de l'agenda… » s'affiche jusqu'à la fin de la lecture.

### Réglages

- **Planning** : repas affichés (Midi / Soir / Les deux, « Soir » par défaut) et « À décider seulement ».
- **Propositions**, **Liste noire** (voir plus haut).
- **Mes idées** : plats à essayer, un par ligne (3 500 caractères au plus). « Surprise Me » les propose avec
  le catalogue, un peu plus souvent ; une idée disparaît d'elle-même dès qu'elle apparaît dans tes repas.
- **Heures des repas** : heure des repas créés depuis l'application (13 h et 20 h par défaut, d'une durée
  d'une heure), et repère pour les autres agendas.
- **Autres agendas**, **Couleur de fond** (dix thèmes et une couleur libre, texte toujours lisible), **Compte**
  (connexion Google, déconnexion ; en mode fichier, « Tout effacer »).

Les réglages partagés (liste noire, propositions, idées, heures) suivent la règle de la section précédente ;
les réglages d'affichage, la couleur et le choix des agendas restent propres à chaque appareil.

### Stats

Chiffres de l'année (repas notés, plats différents, nouveaux plats, repas de la liste noire), « Il y a un an
ce jour-là », les plats les plus mangés sur douze mois et autour de la saison en cours, et le nombre de
nouveaux plats goûtés chaque année.

### Installer l'application

Le site est une application installable : depuis le navigateur du téléphone, « Ajouter à l'écran
d'accueil ». Elle s'ouvre alors en plein écran et hors connexion (la dernière copie du planning ; les
modifications demandent la connexion). Un service worker (`public/sw.js`) charge toujours la dernière version
de la page quand le réseau est là ; les fichiers versionnés viennent du cache ; les appels à Google ne sont
jamais mis en cache.

## Connexion Google

Une connexion Google dans un navigateur dure une heure. À l'expiration, le premier toucher
sur l'écran la renouvelle (la fenêtre Google s'ouvre et se referme seule quand le compte est
connu) ; une action d'écriture (✓, renommage) renouvelle aussi la connexion avant de s'exécuter.
Un refus 403 « trop de requêtes » est réessayé avec une attente progressive au lieu de
déconnecter ; seul un refus 401 ou des autorisations insuffisantes déconnecte, et un appel facultatif
qui échoue (par exemple la recherche de l'adresse du compte) ne fait jamais perdre la connexion. Le jeton est
aussi gardé en mémoire : un navigateur qui refuse d'écrire dans `localStorage` ne provoque plus de fenêtre
de reconnexion à chaque action. Au plus une fenêtre de reconnexion automatique toutes les deux minutes. « Se déconnecter »
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
