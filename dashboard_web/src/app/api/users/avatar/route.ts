import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      )
    }

    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 5MB' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Convertir le fichier en buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Générer un nom de fichier unique
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}.${fileExt}`
    const filePath = `${user.id}/${fileName}`

    // Upload vers Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      // Si le bucket n'existe pas, créer un message d'erreur explicite
      if (uploadError.message.includes('Bucket not found')) {
        return NextResponse.json(
          { error: 'Storage bucket "avatars" not found. Please create it in Supabase Storage.' },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      )
    }

    // Récupérer l'URL publique
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)

    // Supprimer tous les anciens avatars de l'utilisateur
    if (user.avatar_url) {
      try {
        // Lister tous les fichiers dans le dossier de l'utilisateur
        const { data: files, error: listError } = await supabase.storage
          .from('avatars')
          .list(user.id)

        if (!listError && files && files.length > 0) {
          // Supprimer tous les fichiers du dossier utilisateur
          const filesToDelete = files.map(file => `${user.id}/${file.name}`)
          await supabase.storage
            .from('avatars')
            .remove(filesToDelete)
        }
      } catch (error) {
        // Ignorer les erreurs de suppression de l'ancien fichier
        console.error('Error deleting old avatar:', error)
      }
    }

    // Mettre à jour l'URL dans la table users
    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: publicUrl })
      .eq('id', user.id)

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ avatar_url: publicUrl })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = await createClient()

    // Supprimer tous les fichiers du dossier utilisateur
    try {
      const { data: files, error: listError } = await supabase.storage
        .from('avatars')
        .list(user.id)

      if (!listError && files && files.length > 0) {
        const filesToDelete = files.map(file => `${user.id}/${file.name}`)
        await supabase.storage
          .from('avatars')
          .remove(filesToDelete)
      }
    } catch (error) {
      console.error('Error deleting avatar from storage:', error)
    }

    // Mettre à jour la table users
    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: null })
      .eq('id', user.id)

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

