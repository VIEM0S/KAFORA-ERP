'use client';

import { useState } from 'react';
import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const STORE_COUNT_OPTIONS = ['1', '2 à 5', '6 à 10', 'Plus de 10'];

export function ContactSection() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [storeCount, setStoreCount] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, company, phone, storeCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Échec de l'envoi, réessayez plus tard.");
        setStatus('error');
        return;
      }
      setStatus('success');
      setName('');
      setEmail('');
      setMessage('');
      setCompany('');
      setPhone('');
      setStoreCount('');
    } catch {
      setErrorMsg('Connexion impossible, réessayez plus tard.');
      setStatus('error');
    }
  }

  return (
    <section id="contact" className="py-20 bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Contactez-nous</h2>
          <p className="text-xl text-gray-500">Une question, ou envie d&apos;une démonstration ? Notre équipe vous répond rapidement</p>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Par téléphone</h3>
            <a
              href="tel:+22375992482"
              className="inline-flex items-center gap-3 text-lg text-primary-600 hover:text-primary-700"
            >
              <Phone className="h-5 w-5" />
              +223 75 99 24 82
            </a>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
                Nom
              </label>
              <input
                id="contact-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
              />
            </div>

            {/* Champs de qualification B2B — tous optionnels, pour ne pas
                alourdir la démarche d'un particulier pressé, tout en
                permettant à l'équipe de préparer une vraie réponse pour une
                entreprise multi-boutiques. */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-company" className="block text-sm font-medium text-gray-700 mb-1">
                  Entreprise <span className="text-gray-400 font-normal">(optionnel)</span>
                </label>
                <input
                  id="contact-company"
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label htmlFor="contact-phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Téléphone <span className="text-gray-400 font-normal">(optionnel)</span>
                </label>
                <input
                  id="contact-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-field"
                />
              </div>
            </div>

            <div>
              <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="contact-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="contact-store-count" className="block text-sm font-medium text-gray-700 mb-1">
                Nombre de boutiques <span className="text-gray-400 font-normal">(optionnel)</span>
              </label>
              <select
                id="contact-store-count"
                value={storeCount}
                onChange={(e) => setStoreCount(e.target.value)}
                className="input-field"
              >
                <option value="">Je préfère ne pas préciser</option>
                {STORE_COUNT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="contact-message" className="block text-sm font-medium text-gray-700 mb-1">
                Message
              </label>
              <textarea
                id="contact-message"
                required
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="input-field resize-none"
                placeholder="Décrivez votre activité et ce que vous cherchez à résoudre..."
              />
            </div>

            {status === 'success' && (
              <p className="text-sm text-success-600">Message envoyé, merci ! Nous revenons vers vous rapidement.</p>
            )}
            {status === 'error' && <p className="text-sm text-danger-600">{errorMsg}</p>}

            <Button type="submit" disabled={status === 'submitting'} className="w-full">
              {status === 'submitting' ? 'Envoi...' : 'Envoyer'}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
