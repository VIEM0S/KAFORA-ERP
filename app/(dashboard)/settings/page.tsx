'use client';

import { useState, useEffect } from 'react';
import {
  Building2, Globe, Phone, Mail, FileText,
  RefreshCw, CheckCircle2, AlertCircle, Lock, Eye, EyeOff, User
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/hooks/store';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { auth } from '@/lib/firebase/client';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';

const CURRENCIES = [
  { value: 'XOF', label: 'FCFA (XOF) — Franc CFA UEMOA' },
  { value: 'GNF', label: 'Franc guinéen (GNF)' },
  { value: 'MRU', label: 'Ouguiya (MRU)' },
  { value: 'EUR', label: 'Euro (EUR)' },
];

const COUNTRIES = [
  'Mali', 'Sénégal', "Côte d'Ivoire", 'Burkina Faso',
  'Niger', 'Guinée', 'Mauritanie', 'Togo', 'Bénin',
];

export default function SettingsPage() {
  const { tenant, user, setTenant } = useAuthStore();
  const tenantId = tenant?.id;

  // Compte éditeur (SUPER_ADMIN) : il administre Kafora, il n'a pas
  // d'entreprise. Les blocs « Informations entreprise » et « Mon profil »
  // écrivent dans `tenants/{id}/...` — sans tenant, ils sont non seulement
  // vides de sens (RCCM, NIF, devise, mentions de facture) mais leurs
  // enregistrements échoueraient. Seul le changement de mot de passe, qui
  // passe par Firebase Auth, reste pertinent.
  const isPublisher = !tenantId && user?.role === 'SUPER_ADMIN';

  // ─── Infos entreprise ───────────────────────────────────────────────────────
  const [company, setCompany] = useState({
    name: tenant?.name || '',
    email: tenant?.email || '',
    phone: (tenant as unknown as Record<string, string>)?.phone || '',
    address: (tenant as unknown as Record<string, string>)?.address || '',
    city: (tenant as unknown as Record<string, string>)?.city || '',
    country: (tenant as unknown as Record<string, string>)?.country || 'Mali',
    rccm: (tenant as unknown as Record<string, string>)?.rccm || '',
    nif: (tenant as unknown as Record<string, string>)?.nif || '',
    currency: (tenant as unknown as Record<string, string>)?.currency || 'XOF',
  });
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyMsg, setCompanyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ─── Mot de passe ───────────────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ─── Profil ─────────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: user?.phone || '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (tenant) {
      const t = tenant as unknown as Record<string, string>;
      setCompany({
        name: tenant.name || '',
        email: tenant.email || '',
        phone: t.phone || '',
        address: t.address || '',
        city: t.city || '',
        country: t.country || 'Mali',
        rccm: t.rccm || '',
        nif: t.nif || '',
        currency: t.currency || 'XOF',
      });
    }
    if (user) {
      setProfile({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        phone: user.phone || '',
      });
    }
  }, [tenant, user]);

  // ─── Sauvegarder entreprise ──────────────────────────────────────────────────
  const handleSaveCompany = async () => {
    if (!tenantId) return;
    if (!company.name.trim()) { setCompanyMsg({ type: 'error', text: 'Le nom est obligatoire' }); return; }
    setSavingCompany(true); setCompanyMsg(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId), {
        ...company,
        updatedAt: serverTimestamp(),
      });
      setTenant({ ...tenant!, ...company });
      setCompanyMsg({ type: 'success', text: 'Informations mises à jour' });
    } catch (e) {
      setCompanyMsg({ type: 'error', text: 'Erreur lors de la sauvegarde' });
      console.error(e);
    } finally {
      setSavingCompany(false);
      setTimeout(() => setCompanyMsg(null), 3000);
    }
  };

  // ─── Sauvegarder profil ──────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!tenantId || !user) return;
    if (!profile.firstName.trim()) { setProfileMsg({ type: 'error', text: 'Le prénom est obligatoire' }); return; }
    setSavingProfile(true); setProfileMsg(null);
    try {
      await updateDoc(doc(db, `tenants/${tenantId}/users`, user.id), {
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        phone: profile.phone.trim() || null,
        updatedAt: serverTimestamp(),
      });
      setProfileMsg({ type: 'success', text: 'Profil mis à jour' });
    } catch (e) {
      setProfileMsg({ type: 'error', text: 'Erreur lors de la sauvegarde' });
    } finally {
      setSavingProfile(false);
      setTimeout(() => setProfileMsg(null), 3000);
    }
  };

  // ─── Changer mot de passe ────────────────────────────────────────────────────
  const handleChangePw = async () => {
    if (pwForm.next.length < 6) { setPwMsg({ type: 'error', text: 'Minimum 6 caractères' }); return; }
    if (pwForm.next !== pwForm.confirm) { setPwMsg({ type: 'error', text: 'Les mots de passe ne correspondent pas' }); return; }
    if (!pwForm.current) { setPwMsg({ type: 'error', text: 'Saisissez votre mot de passe actuel' }); return; }
    setSavingPw(true); setPwMsg(null);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser || !firebaseUser.email) throw new Error('Non connecté');
      const credential = EmailAuthProvider.credential(firebaseUser.email, pwForm.current);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, pwForm.next);
      setPwForm({ current: '', next: '', confirm: '' });
      setPwMsg({ type: 'success', text: 'Mot de passe modifié avec succès' });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPwMsg({ type: 'error', text: 'Mot de passe actuel incorrect' });
      } else {
        setPwMsg({ type: 'error', text: 'Erreur lors du changement de mot de passe' });
      }
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwMsg(null), 4000);
    }
  };

  const Msg = ({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) => {
    if (!msg) return null;
    return (
      <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
        {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        {msg.text}
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isPublisher ? 'Configuration de votre compte administrateur' : 'Configuration de votre compte et entreprise'}
          </p>
        </div>

        {isPublisher && (
          <Card>
            <CardContent className="p-4 text-sm text-gray-600">
              Ce compte administre la plateforme Kafora : il n&apos;est rattaché à
              aucune entreprise cliente et n&apos;a donc ni informations de
              facturation, ni magasins, ni stock.
            </CardContent>
          </Card>
        )}

        {/* Infos entreprise */}
        {!isPublisher && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary-600" />Informations entreprise</CardTitle>
            <CardDescription>Ces informations apparaissent sur les factures et devis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Msg msg={companyMsg} />
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>Nom de l'entreprise *</Label>
                <Input value={company.name} onChange={e => setCompany(p => ({ ...p, name: e.target.value }))} placeholder="Quincaillerie Alpha" />
              </div>
              <div className="space-y-2">
                <Label>Email professionnel</Label>
                <Input type="email" value={company.email} onChange={e => setCompany(p => ({ ...p, email: e.target.value }))} placeholder="contact@entreprise.com" />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input value={company.phone} onChange={e => setCompany(p => ({ ...p, phone: e.target.value }))} placeholder="+223 70 00 00 00" />
              </div>
              <div className="space-y-2">
                <Label>Ville</Label>
                <Input value={company.city} onChange={e => setCompany(p => ({ ...p, city: e.target.value }))} placeholder="Bamako" />
              </div>
              <div className="space-y-2">
                <Label>Pays</Label>
                <Select value={company.country} onValueChange={v => setCompany(p => ({ ...p, country: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>RCCM</Label>
                <Input value={company.rccm} onChange={e => setCompany(p => ({ ...p, rccm: e.target.value }))} placeholder="BKO-2024-B-1234" />
              </div>
              <div className="space-y-2">
                <Label>NIF</Label>
                <Input value={company.nif} onChange={e => setCompany(p => ({ ...p, nif: e.target.value }))} placeholder="123456789" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Devise</Label>
                <Select value={company.currency} onValueChange={v => setCompany(p => ({ ...p, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveCompany} disabled={savingCompany} className="bg-primary-600 hover:bg-primary-700">
                {savingCompany ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : 'Enregistrer'}
              </Button>
            </div>
          </CardContent>
        </Card>

        )}

        {/* Profil personnel */}
        {!isPublisher && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="h-5 w-5 text-blue-600" />Mon profil</CardTitle>
            <CardDescription>Vos informations personnelles</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Msg msg={profileMsg} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prénom *</Label>
                <Input value={profile.firstName} onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input value={profile.lastName} onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Email</Label>
                <Input value={user?.email || ''} disabled className="bg-gray-50 text-gray-400" />
                <p className="text-xs text-gray-400">L'email ne peut pas être modifié ici</p>
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} placeholder="+223 70 00 00 00" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveProfile} disabled={savingProfile} className="bg-blue-600 hover:bg-blue-700">
                {savingProfile ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</> : 'Mettre à jour'}
              </Button>
            </div>
          </CardContent>
        </Card>

        )}

        {/* Sécurité */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-amber-600" />Sécurité</CardTitle>
            <CardDescription>Changer votre mot de passe</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Msg msg={pwMsg} />
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Mot de passe actuel</Label>
                <div className="relative">
                  <Input type={showPw ? 'text' : 'password'} value={pwForm.current}
                    onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
                    placeholder="••••••••" className="pr-10" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nouveau mot de passe</Label>
                  <Input type="password" value={pwForm.next}
                    onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
                    placeholder="6 caractères minimum" />
                </div>
                <div className="space-y-2">
                  <Label>Confirmer</Label>
                  <Input type="password" value={pwForm.confirm}
                    onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                    placeholder="••••••••" />
                  {pwForm.next && pwForm.confirm && pwForm.next !== pwForm.confirm && (
                    <p className="text-xs text-red-500">Ne correspondent pas</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleChangePw} disabled={savingPw || !pwForm.current || !pwForm.next || !pwForm.confirm}
                className="bg-amber-600 hover:bg-amber-700">
                {savingPw ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Changement...</> : 'Changer le mot de passe'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Abonnement */}
        {tenant && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-purple-600" />Abonnement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-gray-500">Plan</p><p className="font-bold text-lg text-purple-700">{((tenant as unknown as { subscription?: { plan?: string } })?.subscription?.plan) || 'BUSINESS'}</p></div>
                <div><p className="text-gray-500">Statut</p>
                  <span className="inline-block mt-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    {((tenant as unknown as { subscription?: { status?: string } })?.subscription?.status) || 'TRIAL'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
