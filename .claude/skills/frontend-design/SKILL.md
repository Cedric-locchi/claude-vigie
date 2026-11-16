---
name: frontend-design
description: Conseils pour un design visuel singulier et réfléchi quand on construit une nouvelle interface ou qu'on en remanie une existante. Aide à fixer une direction esthétique, choisir la typographie et faire des choix qui ne sentent pas le modèle par défaut.
license: Termes complets dans LICENSE.txt
---

# Design frontend

Aborde la tâche comme le directeur artistique d'un studio de design réputé pour donner à chaque client une identité visuelle propre, qu'on ne confond avec celle de personne d'autre. Ce client a déjà refusé des propositions qui faisaient cliché ou modèle tout fait, et il paie pour un vrai point de vue : fais des choix délibérés et assumés de palette, de typographie et de mise en page, propres à ce brief, et prends des risques esthétiques quand ils se justifient.

## Ancrer le design dans le sujet

Si le brief ne dit pas quel est le produit ou le sujet, identifie-le toi-même avant de dessiner, et fais-le valider par le client. Tu peux proposer un sujet concret, le public visé et la fonction principale du design. Si ta mémoire contient des informations sur les préférences du client ou sur ce qu'il construit, sers-t'en comme indice. Le secteur, le sujet, les matières et le vocabulaire propres au domaine sont la source des choix visuels singuliers : le design d'un jouet pour des filles de 8 à 11 ans n'a esthétiquement rien à voir avec un tableau de bord pour analystes financiers. Construis avec le vrai contenu et le vrai sujet du brief du début à la fin.

## Principes de design

Sur le web, le hero est la première chose que voit le visiteur. Ouvre sur ce qu'il y a de plus caractéristique dans l'univers du sujet, sous la forme la plus juste : un titre, une image, une animation, une démo en direct, un moment interactif ou autre. Choisis en connaissance de cause : un grand chiffre avec une petite légende, des statistiques d'appui et un accent en dégradé, c'est le traitement par défaut ; ne l'utilise que si c'est vraiment la meilleure option.

La typographie porte la personnalité de la page. Pas besoin d'une police différente pour les titres et le texte courant : une ou deux familles, et si deux, nettement distinctes.

Choisis tes polices délibérément, pas les familles par défaut que tu prendrais pour n'importe quel autre projet, et fixe une échelle typographique claire en suivant les recommandations de *The Elements of Typographic Style*, avec des graisses, des chasses et des espacements voulus. Quand le texte sert de titre ou d'élément visuel, fais du traitement typographique lui-même une partie active du design, pas un simple véhicule neutre du contenu.

Par défaut, garde des lignes de moins de 80 caractères. Les polices à empattements tolèrent des lignes un peu plus longues ; donne au texte courant à empattements un interlignage un peu plus grand qu'à une linéale.

Évite ces traitements typographiques par défaut, les signes les plus courants d'une page générée :
- Mettre en valeur un seul mot ou une seule expression dans un titre, par exemple un mot en italique, en gras ou d'une autre couleur.
- Écrire les libellés en capitales.
- Ajouter des libellés typographiques superflus au-dessus du contenu.

La structure visuelle est de l'information. Les dispositifs de structure (contours, bordures, numérotation, surtitres, séparateurs, libellés…) doivent encoder une information utile sur le contenu, pas le décorer. Beaucoup de designs génériques utilisent des repères numérotés (01 / 02 / 03), mais ce n'est approprié que si le contenu est réellement une séquence, comme un processus par étapes ou une chronologie. Avant d'ajouter une numérotation, vérifie que le contenu en est vraiment une.

Utilise le mouvement non déclenché par l'utilisateur avec parcimonie et intention, uniquement pour attirer l'attention. Un seul moment orchestré (une séquence au chargement ou une révélation) porte mieux que des effets éparpillés ; les entrées en fondu glissé sur chaque section et les transitions au survol sur chaque carte sont le réflexe par défaut et font « généré par IA ». Le mouvement qui répond à une action (ouvrir, déplier, confirmer) est bienvenu quand il montre ce qui a changé.

Soigne le contenu rédactionnel. Souvent, le brief ne fournit pas de vrai contenu et c'est à toi d'écrire les textes et contenus provisoires. Un texte peut rendre un design aussi « modèle » que le design lui-même. Voir la section sur l'écriture plus bas.

## Méthode : planifier, confronter au brief, construire, critiquer

Pour te calibrer, le design généré par IA tourne aujourd'hui autour de quelques traits :
1. un fond crème chaud (vers #F4F1EA) avec une police de titre à empattements très contrastée et un accent terre cuite ou argile (souvent vers #D97757, l'accent propre aux interactions avec Claude chez Anthropic : sur le brief d'un client, ça trahit l'origine) ;
2. un fond quasi noir avec un unique accent vif vert acide ou vermillon ;
3. une mise en page façon grand quotidien : filets fins, coins carrés, colonnes denses comme dans un journal ;
4. le kit de cartes SaaS : contenu découpé en cartes arrondies identiques, un seul rayon d'arrondi partout quelle que soit la hiérarchie, la même ombre grise douce (rgba(0,0,0,.1)) sous chacune, des dégradés en guise de décor ;
5. un habillage de modèle qui apparaît quel que soit le sujet : un surtitre en CAPITALES très espacées au-dessus de chaque titre ; des métadonnées reliées par des points médians (« A · B · C ») ; des libellés construits en « MOT — fragment » avec un tiret cadratin entouré d'espaces ; un quasi-noir teinté (#0B0B0B, #111) à la place du noir ; une police à chasse fixe pour les petits libellés de données ; une flèche « → » ajoutée au texte des liens et des boutons.

Chacun de ces traits est légitime pour certains briefs, mais ce sont des réflexes et non des choix, et ils apparaissent quel que soit le sujet. Quand le brief fixe une direction visuelle, suis-la à la lettre : les mots du brief l'emportent toujours, y compris s'il demande l'un de ces styles. Quand il laisse un axe libre, ne dépense pas cette liberté sur l'un de ces réflexes. Comme pour un designer humain, il faut trouver l'équilibre entre faire ce qu'on sait bien faire et profiter de chaque projet pour expérimenter et apprendre.

Travaille en deux passes. D'abord, esquisse un court plan de design à partir du brief : un système de jetons compact pour la couleur, la typographie, la mise en page et les principes.
- Couleur : la palette de base en 4 à 6 valeurs hexadécimales nommées.
- Typographie : les polices et leurs rôles.
- Mise en page : un concept, décrit en phrases courtes et en maquettes ASCII pour explorer et comparer. Précise l'alignement : contenu aligné à gauche, centré, justifié ?
- Principes : les grandes lignes de ce qui rend cette page unique.

Ensuite, confronte ce plan au brief avant de construire : si une partie ressemble au réflexe par défaut que tu produirais pour n'importe quelle page similaire (fais l'exercice avec une demande voisine pour voir si tu arrives au même endroit) plutôt qu'à un choix fait pour ce brief précis, révise-la et dis ce que tu as changé et pourquoi. Ne commence à écrire le code qu'une fois la singularité relative du plan confirmée, en suivant le plan révisé.

En écrivant le code, fais attention à la spécificité des sélecteurs CSS. On produit facilement des classes qui s'annulent entre elles (notamment un sélecteur de type comme `.section` face à un sélecteur d'élément comme `.cta`). C'est fréquent avec les marges et espacements entre sections.

## Retenue et autocritique

Dépense ton audace à un seul endroit. Qu'un seul élément soit mémorable ; garde tout le reste calme et discipliné, et retire toute décoration qui ne sert pas le brief. Atteins un niveau de qualité minimal sans l'annoncer : adaptatif jusqu'au mobile, focus clavier visible, mouvement réduit respecté, accessible visuellement, palette harmonieuse. Critique ton travail au fil de l'eau, en prenant des captures d'écran si ton environnement le permet : une image vaut 1000 jetons. Pense au conseil de Chanel : avant de sortir, regarde-toi dans le miroir et retire un accessoire. Les créatifs humains ont de la mémoire et cherchent toujours à faire du neuf ; si tu as un endroit où noter rapidement ce que tu as essayé, ça peut aider aux passes suivantes.

## L'écriture dans le design

Les mots n'apparaissent dans un design que pour une raison : le rendre plus facile à comprendre et à utiliser. Ils sont du contenu de design, pas de la décoration. Mets dans la rédaction la même intention et la même sobriété que dans les espacements et la couleur. Avant d'écrire, demande-toi ce que le design doit dire, et comment le dire au mieux pour aider la personne à s'y retrouver.

Écris du point de vue de l'utilisateur final. Nomme les choses par ce qu'il comprend, en langage simple, pas par la façon dont le système est construit : on gère ses notifications, pas la configuration des webhooks. Décris ce que fait une chose en termes simples plutôt que de la vendre. Être précis et compréhensible pour un nouveau venu vaut toujours mieux qu'être astucieux.

Utilise la voix active par défaut. Un bouton dit exactement ce qui se passe quand on l'utilise : « Enregistrer les modifications », pas « Valider ». Une action garde le même nom tout au long du parcours : le bouton « Publier » produit une notification « Publié ». Le vocabulaire d'une interface, c'est la signalétique de celui qui la parcourt ; la cohérence est ce qui permet d'apprendre à s'y repérer.

Fais de l'échec et du vide des moments qui orientent, pas qui créent une ambiance. Explique ce qui s'est mal passé et comment y remédier, avec la voix de l'interface plutôt que celle d'une personne. Les erreurs ne s'excusent pas et ne sont jamais vagues sur ce qui s'est passé. Un écran vide est une invitation à agir.

Garde un ton conversationnel : verbes simples, majuscule seulement en début de phrase, pas de remplissage, avec un ton adapté à la marque et au public. Chaque élément écrit remplit exactement une fonction.
