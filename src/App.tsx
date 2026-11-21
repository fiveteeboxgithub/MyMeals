import { useMemo, useRef, useState } from 'react';
import { longDate } from './lib/dates';
import { useGoogleMeals } from './lib/googleStore';
import { parseIcs } from './lib/ics';
import { useMeals } from './lib/store';
import { Notice } from './Notice';
import { Planner } from './Planner';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
const GOOGLE_CALENDAR_NAME = import.meta.env.VITE_GOOGLE_CALENDAR_NAME?.trim() || 'Repas';

/** Avec un ID client Google, l'agenda est la référence ; sinon tout reste dans le navigateur. */
export function App() {
  return GOOGLE_CLIENT_ID ? <GoogleApp /> : <LocalApp />;
}

function GoogleApp() {
  const store = useGoogleMeals(GOOGLE_CLIENT_ID, GOOGLE_CALENDAR_NAME);
  const { connected, canRenew, syncing, error, meals } = store;
  const connectButton = (
    <button className="ghost-btn primary" onClick={store.connect}>
      {canRenew ? 'Reconnecter' : 'Se connecter avec Google'}
    </button>
  );
  const calendars = useMemo(
    () => (connected ? { list: store.listCalendars, events: store.listTimedEvents, mealsCalendarId: store.mealsCalendarId } : undefined),
    [connected, store.listCalendars, store.listTimedEvents, store.mealsCalendarId],
  );
  return (
    <Planner
      store={store}
      settingsSync={{ remote: store.settings, save: store.saveSettings }}
      imagesSync={{ remote: store.images, save: store.saveImages }}
      calendars={calendars}
      loading={connected && !store.synced && !error}
      headerAction={connected ? syncing ? <span className="sync-status">Synchronisation…</span> : null : connectButton}
      banner={
        <>
          {error && <Notice text={error} onClose={store.dismissError} />}
          {!connected && !error && (
            <p className="notice" role="status">
              {canRenew
                ? "La connexion Google a expiré (elle dure une heure). Touche l'écran pour la renouveler, ou utilise « Reconnecter »."
                : meals.length === 0
                  ? `Connecte-toi avec Google pour afficher l'agenda « ${GOOGLE_CALENDAR_NAME} » et recevoir des propositions.`
                  : "Tu vois la dernière copie de l'agenda. Connecte-toi avec Google pour le modifier."}
            </p>
          )}
        </>
      }
      account={
        connected ? (
          <>
            <p>
              Connecté à Google{store.account ? ` (${store.account})` : ''}, agenda « {GOOGLE_CALENDAR_NAME} ».
            </p>
            <button className="ghost-btn" onClick={store.disconnect}>
              Se déconnecter
            </button>
          </>
        ) : (
          connectButton
        )
      }
      footer={`synchronisés avec l'agenda « ${GOOGLE_CALENDAR_NAME} »`}
    />
  );
}

function LocalApp() {
  const { meals, importMeals, setSlot, addMeal, clearSlot, removeMeal, clearAll, renameMeals, setNote, moveMeal } = useMeals();
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const imported = parseIcs(await file.text());
      if (imported.length === 0) {
        setNotice("Aucun repas trouvé dans ce fichier. Il faut le fichier .ics (dézippé) exporté depuis Google Agenda.");
        return;
      }
      importMeals(imported);
      const dates = imported.map((m) => m.date).sort();
      setNotice(`${imported.length} repas importés, du ${longDate(dates[0])} au ${longDate(dates[dates.length - 1])}.`);
    } catch {
      setNotice('Impossible de lire ce fichier.');
    }
  }

  const importButton = (
    <>
      <button className="ghost-btn" onClick={() => fileInput.current?.click()}>
        Importer un .ics
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".ics,.ical,text/calendar"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );

  return (
    <Planner
      store={{ meals, setSlot, addMeal, clearSlot, removeMeal, renameMeals, setNote, moveMeal, toggleLike: () => undefined }}
      headerAction={importButton}
      banner={
        <>
          {notice && <Notice text={notice} onClose={() => setNotice('')} />}
          {meals.length === 0 && (
            <section className="empty">
              <h2>Commencer avec ton historique</h2>
              <ol>
                <li>Sur ordinateur, ouvre Google Agenda, puis Paramètres.</li>
                <li>À gauche, clique sur l'agenda « Repas », puis sur « Exporter l'agenda ».</li>
                <li>Dézippe le fichier téléchargé : il contient un fichier .ics.</li>
                <li>Clique sur « Importer un .ics » ci-dessus et choisis ce fichier.</li>
              </ol>
              <p>Le fichier reste dans ce navigateur : rien n'est envoyé sur un serveur.</p>
            </section>
          )}
        </>
      }
      account={
        <>
          <p>Sans compte Google : les repas restent dans ce navigateur.</p>
          <button
            className="ghost-btn"
            onClick={() => {
              if (confirm('Effacer tous les repas enregistrés dans ce navigateur ?')) clearAll();
            }}
          >
            Tout effacer
          </button>
        </>
      }
      footer="enregistrés dans ce navigateur"
    />
  );
}
