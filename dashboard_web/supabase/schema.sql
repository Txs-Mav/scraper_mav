-- Schéma de base de données Supabase pour le système de gestion utilisateur

-- Extension pour générer des UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('main', 'employee', 'user', 'owner', 'member')),
  subscription_plan TEXT CHECK (subscription_plan IN ('free', 'standard', 'premium')),
  stripe_customer_id TEXT,
  avatar_url TEXT,
  main_account_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'standard', 'premium')),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table employees
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  main_account_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(main_account_id, employee_id)
);

-- Table scrapings
CREATE TABLE IF NOT EXISTS scrapings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_url TEXT NOT NULL,
  competitor_urls TEXT[] DEFAULT '{}',
  products JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  scraping_time_seconds FLOAT,
  mode TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table scraper_cache
CREATE TABLE IF NOT EXISTS scraper_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  scraper_code TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  selectors JSONB DEFAULT '{}',
  product_urls JSONB DEFAULT '[]',
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
  template_version TEXT DEFAULT '1.0',
  last_product_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'error', 'pending')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, cache_key)
);

-- Table scraper_shares (partage de scrapers entre utilisateurs)
CREATE TABLE IF NOT EXISTS scraper_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scraper_cache_id UUID NOT NULL REFERENCES scraper_cache(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'write', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(scraper_cache_id, target_user_id)
);

-- Table organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table user_roles (source de vérité pour le rôle courant)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'owner', 'member')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table organization_members
CREATE TABLE IF NOT EXISTS organization_members (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

-- Table org_invitations
CREATE TABLE IF NOT EXISTS org_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_main_account_id ON users(main_account_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_main_account_id ON employees(main_account_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_scrapings_user_id ON scrapings(user_id);
CREATE INDEX IF NOT EXISTS idx_scrapings_created_at ON scrapings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_cache_user_id ON scraper_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_scraper_cache_cache_key ON scraper_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_scraper_cache_site_url ON scraper_cache(site_url);
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_scraper_shares_scraper_cache_id ON scraper_shares(scraper_cache_id);
CREATE INDEX IF NOT EXISTS idx_scraper_shares_target_user_id ON scraper_shares(target_user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scrapings_updated_at BEFORE UPDATE ON scrapings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scraper_cache_updated_at BEFORE UPDATE ON scraper_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organization_members_updated_at BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_org_invitations_updated_at BEFORE UPDATE ON org_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_roles_updated_at BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scraper_shares_updated_at BEFORE UPDATE ON scraper_shares
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Fonction pour créer automatiquement un utilisateur dans la table users après inscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_subscription_plan TEXT;
BEGIN
  user_subscription_plan := COALESCE(NEW.raw_user_meta_data->>'subscription_plan', 'free');
  
  -- Créer l'utilisateur dans la table users
  INSERT INTO public.users (id, email, name, role, subscription_plan)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', 'User'),
    'user',
    user_subscription_plan
  )
  ON CONFLICT (id) DO NOTHING;
  
  -- Créer l'entrée dans subscriptions
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (
    NEW.id,
    user_subscription_plan,
    'active'
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger pour créer l'utilisateur automatiquement
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Upsert le rôle 'user' dans user_roles à la création (fallback)
CREATE OR REPLACE FUNCTION public.set_default_user_role()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.set_default_user_role();

-- ----------------------------
-- Rôles dynamiques via triggers org
-- ----------------------------

-- Quand on crée une organisation, l'owner devient 'owner'
CREATE OR REPLACE FUNCTION public.set_owner_role_on_org_create()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.owner_id, 'owner')
  ON CONFLICT (user_id) DO UPDATE SET role = 'owner';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_created_set_owner_role
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_owner_role_on_org_create();

-- Quand on ajoute un membre dans une org, il devient 'member'
CREATE OR REPLACE FUNCTION public.set_member_role_on_join()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, 'member')
  ON CONFLICT (user_id) DO UPDATE SET role = 'member';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_member_added_set_member_role
  AFTER INSERT ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.set_member_role_on_join();

-- Quand un membre quitte une org, si plus d'org alors role='user'
CREATE OR REPLACE FUNCTION public.set_user_role_on_leave()
RETURNS TRIGGER AS $$
DECLARE
  org_count INT;
BEGIN
  SELECT COUNT(*) INTO org_count
  FROM public.organization_members
  WHERE user_id = OLD.user_id;

  IF org_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (OLD.user_id, 'user')
    ON CONFLICT (user_id) DO UPDATE SET role = 'user';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_member_removed_set_user_role
  AFTER DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.set_user_role_on_leave();

-- Quand on supprime une organisation : owner repasse 'user', membres aussi via DELETE membership
CREATE OR REPLACE FUNCTION public.set_user_role_on_org_delete()
RETURNS TRIGGER AS $$
DECLARE
  owner_id UUID;
BEGIN
  owner_id := OLD.owner_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (owner_id, 'user')
  ON CONFLICT (user_id) DO UPDATE SET role = 'user';

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_deleted_set_owner_user
  AFTER DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_user_role_on_org_delete();

-- Row Level Security (RLS) Policies

-- Activer RLS sur toutes les tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrapings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

-- Policies pour users
CREATE POLICY "Users can view their own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can view members of their main account"
  ON users FOR SELECT
  USING (
    auth.uid() = main_account_id OR
    id IN (
      SELECT employee_id FROM employees WHERE main_account_id = auth.uid()
    )
  );

-- Policy: owners can view all users (pour recherche globale depuis l'owner)
CREATE POLICY "Owners can view all users"
  ON users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u2 WHERE u2.id = auth.uid() AND u2.role = 'main'
    )
  );

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Policies pour subscriptions
CREATE POLICY "Users can view their own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Main accounts can view subscriptions of their employees"
  ON subscriptions FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM users WHERE main_account_id = auth.uid()
    )
  );

-- Policy pour permettre l'insertion de subscription lors de la création de compte
CREATE POLICY "Users can insert their own subscription"
  ON subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policies pour employees
CREATE POLICY "Main accounts can view their employees"
  ON employees FOR SELECT
  USING (main_account_id = auth.uid());

CREATE POLICY "Main accounts can insert employees"
  ON employees FOR INSERT
  WITH CHECK (main_account_id = auth.uid());

CREATE POLICY "Main accounts can delete their employees"
  ON employees FOR DELETE
  USING (main_account_id = auth.uid());

-- Policies pour scrapings
CREATE POLICY "Users can view their own scrapings"
  ON scrapings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Main accounts can view scrapings of their employees"
  ON scrapings FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM users WHERE main_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own scrapings"
  ON scrapings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scrapings"
  ON scrapings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scrapings"
  ON scrapings FOR DELETE
  USING (auth.uid() = user_id);

-- Policies pour scraper_cache
CREATE POLICY "Users can view their own scraper cache"
  ON scraper_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Main accounts can view scraper cache of their employees"
  ON scraper_cache FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM users WHERE main_account_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own scraper cache"
  ON scraper_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scraper cache"
  ON scraper_cache FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scraper cache"
  ON scraper_cache FOR DELETE
  USING (auth.uid() = user_id);

-- Policies pour scraper_shares
CREATE POLICY "Shares visible to owner or target"
  ON scraper_shares FOR SELECT
  USING (auth.uid() = owner_user_id OR auth.uid() = target_user_id);

CREATE POLICY "Owner can create share on own scraper"
  ON scraper_shares FOR INSERT
  WITH CHECK (
    owner_user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM scraper_cache sc
      WHERE sc.id = scraper_cache_id AND sc.user_id = auth.uid()
    )
  );

CREATE POLICY "Owner can update share"
  ON scraper_shares FOR UPDATE
  USING (owner_user_id = auth.uid());

CREATE POLICY "Owner can delete share"
  ON scraper_shares FOR DELETE
  USING (owner_user_id = auth.uid());

-- Policies pour user_roles
-- chaque user gère son rôle, owners peuvent voir leurs membres via org_members (en SELECT ci-dessous)
CREATE POLICY "User can view own role"
  ON user_roles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "User can update own role"
  ON user_roles FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "User can insert own role"
  ON user_roles FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Owners peuvent voir les rôles des membres de leur organisation
CREATE POLICY "Owner can view member roles"
  ON user_roles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM organization_members om_owner
      WHERE om_owner.user_id = auth.uid()
        AND om_owner.role = 'owner'
        AND EXISTS (
          SELECT 1
          FROM organization_members om_member
          WHERE om_member.org_id = om_owner.org_id
            AND om_member.user_id = user_roles.user_id
        )
    )
  );

-- Policies pour organizations
CREATE POLICY "Owner can view own org"
  ON organizations FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Owner can insert org"
  ON organizations FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner can update org"
  ON organizations FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Owner can delete org"
  ON organizations FOR DELETE
  USING (owner_id = auth.uid());

-- Policies pour organization_members
CREATE POLICY "Members can view their org membership"
  ON organization_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organizations o WHERE o.id = org_id AND o.owner_id = auth.uid()
    )
  );

CREATE POLICY "User can delete own membership"
  ON organization_members FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Owner can insert member"
  ON organization_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations o WHERE o.id = org_id AND o.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owner can delete member"
  ON organization_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM organizations o WHERE o.id = org_id AND o.owner_id = auth.uid()
    )
  );

-- Policies pour org_invitations
CREATE POLICY "Owner can manage invitations of own org"
  ON org_invitations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organizations o WHERE o.id = org_id AND o.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations o WHERE o.id = org_id AND o.owner_id = auth.uid()
    )
  );

CREATE POLICY "Invitee can view invitations by email"
  ON org_invitations FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Policies pour user_settings
CREATE POLICY "Users can view their own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own settings"
  ON user_settings FOR DELETE
  USING (auth.uid() = user_id);

-- Policies pour webhooks
CREATE POLICY "Users can view their own webhooks"
  ON webhooks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own webhooks"
  ON webhooks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own webhooks"
  ON webhooks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own webhooks"
  ON webhooks FOR DELETE
  USING (auth.uid() = user_id);


