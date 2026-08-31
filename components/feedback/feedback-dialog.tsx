'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const SEVERITY_OPTIONS = [
  { value: 'BUG', label: 'Bug — quelque chose ne marche pas' },
  { value: 'SUGGESTION', label: 'Suggestion — une idée à proposer' },
  { value: 'QUESTION', label: 'Question' },
];

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Canal de retour client basique (voir app/api/feedback/route.ts) — décidé
// en session le 2026-08-31 pour capter les bugs réels dès les premiers
// utilisateurs. Le contexte (page, tenant, utilisateur) est capturé en
// silence côté serveur depuis la session : rien à remplir en plus par
// l'utilisateur au-delà du message.
export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const pathname = usePathname();
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState('BUG');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const reset = () => { setMessage(''); setSeverity('BUG'); setError(null); setSent(false); };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleSend = async () => {
    if (!message.trim()) { setError('Décrivez le problème ou la suggestion.'); return; }
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), severity, pageUrl: pathname }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de l'envoi");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'envoi, réessayez plus tard.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Signaler un problème</DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center text-center py-6 gap-3">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="font-medium text-gray-900">Message envoyé, merci !</p>
            <p className="text-sm text-gray-500">Nous revenons vers vous si besoin.</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="space-y-3 py-2">
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Décrivez ce qui se passe..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                autoFocus
              />
            </div>
          </>
        )}

        <DialogFooter>
          {sent ? (
            <Button onClick={() => handleClose(false)} className="bg-primary-600 hover:bg-primary-700">Fermer</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={isSending}>Annuler</Button>
              <Button onClick={handleSend} disabled={isSending} className="bg-primary-600 hover:bg-primary-700">
                {isSending ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Envoi...</> : 'Envoyer'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
