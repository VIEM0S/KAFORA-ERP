'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2, Users, Package, CreditCard,
  CheckCircle2, ArrowLeft, ArrowRight, Loader2, Store
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PLAN_DISPLAY_LIST } from '@/lib/utils/plan-display';

const STEPS = [
  { id: 'company', title: 'Informations entreprise', icon: Building2 },
  { id: 'stores',  title: 'Magasin principal',        icon: Store     },
  { id: 'users',   title: 'Compte administrateur',    icon: Users     },
  { id: 'plan',    title: "Plan d'abonnement",         icon: CreditCard },
];

// Fix : cette page avait sa propre copie en dur des forfaits (retrouvée aussi
// dans lib/constants/index.ts, app/api/auth/register/route.ts et app/page.tsx).
// L'affichage vient maintenant de lib/utils/plan-display.ts, lui-même basé sur
// la source unique SUBSCRIPTION_PLANS.
const PLANS = PLAN_DISPLAY_LIST;

/**
 * Version des conditions acceptées, enregistrée avec chaque compte.
 *
 * À INCRÉMENTER à chaque modification substantielle des CGV : sans cela,
 * impossible de savoir plus tard quelle version un client donné a acceptée,
 * ni de démontrer qu'il a bien consenti au texte qui lui est opposé.
 */
const TERMS_VERSION = '2026-08-01';

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [company, setCompany] = useState({
    name: '', email: '', phone: '', address: '', city: '',
    country: 'Mali', rccm: '', nif: '', currency: 'XOF',
  });
  const [store, setStore] = useState({ name: '', code: '', address: '', city: '', phone: '' });
  const [user, setUser] = useState({
    firstName: '', lastName: '', email: '', password: '', confirmPassword: '', phone: '',
  });
  const [plan, setPlan] = useState('BUSINESS');

  // Acceptation explicite des conditions. Sans cette case, des CGV même
  // parfaitement rédigées ne sont opposables à personne : il faut pouvoir
  // démontrer que le client les a acceptées, à une date donnée, dans une
  // version donnée.
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const isStepValid = () => {
    if (step === 0) return !!(company.name && company.email);
    if (step === 1) return !!(store.name);
    if (step === 2) return !!(user.firstName && user.lastName && user.email && user.password && user.password === user.confirmPassword);
    // Dernière étape : impossible de créer le compte sans accepter les
    // conditions. Case NON pré-cochée — un consentement pré-coché n'en est
    // pas un, et se retourne contre celui qui s'en prévaut.
    if (step === 3) return acceptedTerms;
    return true;
  };

  const handleNext = () => {
    setError(null);
    if (step < STEPS.length - 1) { setStep(step + 1); return; }
    handleSubmit();
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company, store, user, plan,
          // Preuve d'acceptation : version et horodatage sont enregistrés
          // côté serveur avec le compte.
          acceptedTerms: true,
          termsVersion: TERMS_VERSION,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la création du compte');
      router.push('/login?registered=true');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <Link
          href="/"
          onClick={(e) => {
            const started = !!(company.name || company.email || user.firstName || user.email);
            if (started && !confirm('Quitter la configuration ? Les informations déjà saisies seront perdues.')) {
              e.preventDefault();
            }
          }}
          className="inline-flex items-center gap-1.5 text-sm text-primary-200 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à l'accueil
        </Link>

        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4 hover:bg-white/20 transition-colors">
            <Store className="h-8 w-8 text-white" />
          </Link>
          <Link href="/">
            <h1 className="text-3xl font-bold text-white hover:text-primary-200 transition-colors">Kafora</h1>
          </Link>
          <p className="text-primary-200 mt-2">Configuration de votre espace de gestion</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors ${
                i < step ? 'bg-success-500 border-success-500 text-white'
                : i === step ? 'bg-white border-white text-primary-900'
                : 'border-white/30 text-white/40'}`}>
                {i < step ? <CheckCircle2 className="h-5 w-5" /> : <s.icon className="h-5 w-5" />}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-12 h-0.5 mx-1 transition-colors ${i < step ? 'bg-success-500' : 'bg-white/20'}`} />
              )}
            </div>
          ))}
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>{STEPS[step].title}</CardTitle>
            <CardDescription>Étape {step + 1} sur {STEPS.length}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Étape 1 — Entreprise */}
            {step === 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2 space-y-2">
                  <Label>Nom de l'entreprise *</Label>
                  <Input id="company-name" name="company-name" autoComplete="organization" value={company.name} onChange={e => setCompany({...company, name: e.target.value})} placeholder="Ex: Quincaillerie Alpha" />
                </div>
                <div className="space-y-2">
                  <Label>Email professionnel *</Label>
                  <Input id="company-email" name="company-email" type="email" autoComplete="email" value={company.email} onChange={e => setCompany({...company, email: e.target.value})} placeholder="contact@entreprise.com" />
                </div>
                <div className="space-y-2">
                  <Label>Téléphone</Label>
                  <Input id="company-phone" name="company-phone" type="tel" autoComplete="tel" value={company.phone} onChange={e => setCompany({...company, phone: e.target.value})} placeholder="+223 70 00 00 00" />
                </div>
                <div className="space-y-2">
                  <Label>Ville</Label>
                  <Input id="company-city" name="company-city" autoComplete="address-level2" value={company.city} onChange={e => setCompany({...company, city: e.target.value})} placeholder="Bamako" />
                </div>
                <div className="space-y-2">
                  <Label>Pays</Label>
                  <Select value={company.country} onValueChange={v => setCompany({...company, country: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {/* Zone UEMOA uniquement : tous ces pays utilisent le
                          franc CFA (XOF), seule devise gérée par Kafora.
                          Proposer le Ghana, le Nigeria ou le Maroc laissait
                          croire à une prise en charge de leur monnaie, qui
                          n'existe pas — les montants y seraient affichés en
                          FCFA sans aucune conversion. */}
                      <SelectItem value="Mali">Mali</SelectItem>
                      <SelectItem value="Sénégal">Sénégal</SelectItem>
                      <SelectItem value="Côte d'Ivoire">Côte d&apos;Ivoire</SelectItem>
                      <SelectItem value="Burkina Faso">Burkina Faso</SelectItem>
                      <SelectItem value="Niger">Niger</SelectItem>
                      <SelectItem value="Bénin">Bénin</SelectItem>
                      <SelectItem value="Togo">Togo</SelectItem>
                      <SelectItem value="Guinée-Bissau">Guinée-Bissau</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Devise</Label>
                  {/* Pas un choix : Kafora fonctionne exclusivement en franc
                      CFA et ne convertit rien. Un sélecteur laisserait croire
                      le contraire dès la première minute d'utilisation. */}
                  <div className="flex h-10 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700">
                    FCFA (XOF)
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>RCCM</Label>
                  <Input id="rccm" name="rccm" autoComplete="off" value={company.rccm} onChange={e => setCompany({...company, rccm: e.target.value})} placeholder="BKO-2024-B-1234" />
                </div>
                <div className="space-y-2">
                  <Label>NIF</Label>
                  <Input id="nif" name="nif" autoComplete="off" value={company.nif} onChange={e => setCompany({...company, nif: e.target.value})} placeholder="123456789" />
                </div>
              </div>
            )}

            {/* Étape 2 — Magasin */}
            {step === 1 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2 space-y-2">
                  <Label>Nom du magasin *</Label>
                  <Input id="store-name" name="store-name" autoComplete="off" value={store.name} onChange={e => setStore({...store, name: e.target.value})} placeholder="Ex: Magasin Central" />
                </div>
                <div className="space-y-2">
                  <Label>Code magasin</Label>
                  <Input id="store-code" name="store-code" autoComplete="off" value={store.code} onChange={e => setStore({...store, code: e.target.value})} placeholder="MCT" maxLength={5} />
                </div>
                <div className="space-y-2">
                  <Label>Téléphone</Label>
                  <Input id="store-phone" name="store-phone" type="tel" autoComplete="tel" value={store.phone} onChange={e => setStore({...store, phone: e.target.value})} placeholder="+223 70 00 00 00" />
                </div>
                <div className="space-y-2">
                  <Label>Ville</Label>
                  <Input id="store-city" name="store-city" autoComplete="address-level2" value={store.city} onChange={e => setStore({...store, city: e.target.value})} placeholder="Bamako" />
                </div>
                <div className="space-y-2">
                  <Label>Adresse</Label>
                  <Input id="store-address" name="store-address" autoComplete="street-address" value={store.address} onChange={e => setStore({...store, address: e.target.value})} placeholder="Rue 123, Quartier..." />
                </div>
              </div>
            )}

            {/* Étape 3 — Utilisateur admin */}
            {step === 2 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Prénom *</Label>
                  <Input id="firstName" name="firstName" autoComplete="given-name" value={user.firstName} onChange={e => setUser({...user, firstName: e.target.value})} placeholder="Moussa" />
                </div>
                <div className="space-y-2">
                  <Label>Nom *</Label>
                  <Input id="lastName" name="lastName" autoComplete="family-name" value={user.lastName} onChange={e => setUser({...user, lastName: e.target.value})} placeholder="Coulibaly" />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input id="userEmail" name="userEmail" type="email" autoComplete="email" value={user.email} onChange={e => setUser({...user, email: e.target.value})} placeholder="vous@exemple.com" />
                </div>
                <div className="space-y-2">
                  <Label>Téléphone</Label>
                  <Input id="userPhone" name="userPhone" type="tel" autoComplete="tel" value={user.phone} onChange={e => setUser({...user, phone: e.target.value})} placeholder="+223 70 00 00 00" />
                </div>
                <div className="space-y-2">
                  <Label>Mot de passe *</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" value={user.password} onChange={e => setUser({...user, password: e.target.value})} placeholder="8 caractères minimum" />
                </div>
                <div className="space-y-2">
                  <Label>Confirmer le mot de passe *</Label>
                  <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" value={user.confirmPassword} onChange={e => setUser({...user, confirmPassword: e.target.value})} placeholder="••••••••" />
                  {user.password && user.confirmPassword && user.password !== user.confirmPassword && (
                    <p className="text-xs text-red-500">Les mots de passe ne correspondent pas</p>
                  )}
                </div>
              </div>
            )}

            {/* Étape 4 — Plan */}
            {step === 3 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {PLANS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPlan(p.id)}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                      plan === p.id ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {p.popular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-xs px-3 py-1 rounded-full">
                        Recommandé
                      </span>
                    )}
                    <p className="font-bold text-gray-900">{p.name}</p>
                    <p className="text-2xl font-bold text-primary-600 mt-1">
                      {p.price.toLocaleString('fr-FR')} <span className="text-sm font-normal text-gray-500">FCFA/mois</span>
                    </p>
                    <ul className="mt-3 space-y-1">
                      {p.features.map(f => (
                        <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success-500 flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-gray-400 mt-3">14 jours d'essai gratuit</p>
                  </button>
                ))}
              </div>
            )}

            {step === 3 && (
              <label className="mt-6 flex items-start gap-3 rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-gray-300 transition-colors">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 flex-shrink-0"
                  checked={acceptedTerms}
                  onChange={e => setAcceptedTerms(e.target.checked)}
                />
                <span className="text-sm text-gray-700">
                  J&apos;ai lu et j&apos;accepte les{' '}
                  <a href="/cgv" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline font-medium">
                    conditions générales
                  </a>{' '}
                  et la{' '}
                  <a href="/confidentialite" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline font-medium">
                    politique de confidentialité
                  </a>{' '}
                  de Kafora.
                  <span className="block text-xs text-gray-500 mt-1">
                    Les liens s&apos;ouvrent dans un nouvel onglet : vous ne perdrez
                    pas les informations déjà saisies.
                  </span>
                </span>
              </label>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep(step - 1)} disabled={step === 0 || isLoading}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Précédent
              </Button>
              <Button onClick={handleNext} disabled={!isStepValid() || isLoading} className="bg-primary-600 hover:bg-primary-700">
                {isLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Création en cours...</>
                ) : step === STEPS.length - 1 ? (
                  <><CheckCircle2 className="mr-2 h-4 w-4" /> Créer mon compte</>
                ) : (
                  <>Suivant <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
