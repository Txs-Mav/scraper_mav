import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = await createClient()

    // Owner : invitations de son org ; sinon : invitations pour son email
    const { data: ownerOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)

    const isOwner = !!ownerOrg && ownerOrg.length > 0

    const query = supabase
      .from('org_invitations')
      .select('id, org_id, email, status, message, created_at, organizations(name)')

    if (isOwner) {
      query.eq('org_id', ownerOrg[0].id)
    } else {
      query.eq('email', user.email || '')
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ invitations: data || [] })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { email, message } = await request.json()
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Vérifier que l'utilisateur est owner d'une org
    const { data: ownerOrg, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('owner_id', user.id)
      .limit(1)

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 })
    }
    if (!ownerOrg || ownerOrg.length === 0) {
      return NextResponse.json({ error: 'Créez d’abord votre organisation' }, { status: 400 })
    }

    const orgName = ownerOrg[0].name || 'votre organisation'
    const fromEmail =
      process.env.EMAIL_FROM ||
      process.env.INVITE_FROM_EMAIL ||
      'gestion@go-data.co'
    const baseMessage = `Vous avez été invité à rejoindre l’organisation ${orgName}.`
    const finalMessage = (message && message.trim()) ? message.trim() : baseMessage

    // Insérer l'invitation
    const { data: invite, error: inviteError } = await supabase
      .from('org_invitations')
      .insert({
        org_id: ownerOrg[0].id,
        email,
        message: finalMessage,
        status: 'pending',
      })
      .select()
      .single()

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 })
    }

    // Envoyer l'email d'invitation avec lien vers la page de création de compte
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      request.headers.get('origin') ||
      'http://localhost:3000'
    const inviteLink = `${baseUrl}/create-account?invite_id=${invite.id}`

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({
        invitation: invite,
        email_sent: false,
        email_error: 'RESEND_API_KEY manquant pour l’envoi des emails',
      })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const emailSubject = `Invitation à rejoindre ${orgName}`
    const emailBody = `
      <p>${baseMessage}</p>
      ${finalMessage ? `<p>${finalMessage}</p>` : ''}
      <p>Pour créer votre compte et accepter l’invitation, cliquez ici :</p>
      <p><a href="${inviteLink}">${inviteLink}</a></p>
      <p>Si vous avez déjà un compte, connectez-vous puis acceptez l’invitation depuis votre espace.</p>
    `

    const { error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: emailSubject,
      html: emailBody,
    })

    if (emailError) {
      return NextResponse.json({
        invitation: invite,
        email_sent: false,
        email_error: emailError.message,
      })
    }

    return NextResponse.json({ invitation: invite, email_sent: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


