import { useEffect, useState } from 'react';

// Avertissement doux si hors des horaires habituels de l'utilisateur — jamais
// un blocage (certaines boutiques tournent en continu, un horaire strict
// casserait leur activité). Recalculé chaque minute.
export function useWorkingHoursWarning(workingHours: { start: string; end: string } | null | undefined) {
  const [outsideHours, setOutsideHours] = useState(false);

  useEffect(() => {
    // Dépend de l'heure actuelle (new Date()), non déterministe — ne peut
    // pas être calculé pendant le rendu, recalculé ici toutes les minutes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!workingHours?.start || !workingHours?.end) { setOutsideHours(false); return; }
    const check = () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = workingHours.start.split(':').map(Number);
      const [eh, em] = workingHours.end.split(':').map(Number);
      const startMin = sh * 60 + sm, endMin = eh * 60 + em;
      const inRange = startMin <= endMin
        ? nowMinutes >= startMin && nowMinutes <= endMin
        : nowMinutes >= startMin || nowMinutes <= endMin; // horaire à cheval sur minuit
      setOutsideHours(!inRange);
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [workingHours]);

  return outsideHours;
}
