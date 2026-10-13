# Zoeken in registerbeheer

De beheerinterface filtert uitsluitend de bestaande geautoriseerde
activiteitensamenvattingen uit `GET /api/activities`. De API en responsevelden
blijven ongewijzigd.

- Tekstzoekveld: naam en activiteit-ID samen, alleen naam of alleen activiteit-ID.
  Vergelijking negeert hoofdletters en witruimte aan begin/einde.
- Status: alle activiteiten, met minstens één concept, met minstens één
  gepubliceerde versie, of uitsluitend concepten. Concept en gepubliceerd zijn
  niet exclusief: één activiteit kan beide bevatten.
- Versies: alle activiteiten, één versie of meerdere versies (totaal inclusief
  concepten).
- Alle actieve filters gelden gezamenlijk. Resultaatmelding toont zichtbaar en
  totaal aantal activiteiten; bij nul resultaten biedt de interface reset.
- Sortering: naam oplopend/aflopend of meeste versies eerst, met naam en ID als
  vaste secundaire sortering. Standaard naam oplopend.
- Wissen herstelt alle standaardwaarden zonder data te wijzigen.

Filtering bepaalt alleen de lijst. Een al geopend detail blijft raadpleegbaar
en wordt als buiten de selectie gemarkeerd wanneer filters het uitsluiten.
