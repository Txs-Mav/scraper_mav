import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, isMainAccount } from '@/lib/supabase/helpers'

export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Vérifier que c'est un compte principal
    if (!(await isMainAccount(user.id))) {
      return NextResponse.json(
        { error: 'Only main accounts can view members' },
        { status: 403 }
      )
    }

    const supabase = await createClient()

    // Récupérer tous les membres (employés) liés à ce compte
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('*, employee:users!employee_id(*)')
      .eq('main_account_id', user.id)

    if (employeesError) {
      return NextResponse.json(
        { error: employeesError.message },
        { status: 500 }
      )
    }

    // Récupérer aussi le compte principal
    const { data: mainAccount, error: mainError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (mainError) {
      return NextResponse.json(
        { error: mainError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      mainAccount,
      employees: employees || [],
    })
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
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Vérifier que c'est un compte principal
    if (!(await isMainAccount(user.id))) {
      return NextResponse.json(
        { error: 'Only main accounts can add members' },
        { status: 403 }
      )
    }

    const { name, email, role, permissions = [] } = await request.json()

    if (!name || !email || !role) {
      return NextResponse.json(
        { error: 'Name, email, and role are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Créer le compte employé via Supabase Auth
    const tempPassword = Math.random().toString(36).slice(-12) // Mot de passe temporaire
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password: tempPassword,
    })

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      )
    }

    // Créer l'entrée dans la table users
    const { error: userError } = await supabase.from('users').insert({
      id: authData.user.id,
      name,
      email,
      role: 'employee',
      main_account_id: user.id,
    })

    if (userError) {
      // Note: En production, utilisez la service role key pour supprimer l'utilisateur
      return NextResponse.json(
        { error: userError.message },
        { status: 500 }
      )
    }

    // Créer l'entrée dans la table employees
    const { error: employeeError } = await supabase.from('employees').insert({
      main_account_id: user.id,
      employee_id: authData.user.id,
      role,
      permissions,
    })

    if (employeeError) {
      return NextResponse.json(
        { error: employeeError.message },
        { status: 500 }
      )
    }

    // Récupérer les données de l'employé créé
    const { data: employeeData, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single()

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to fetch employee data' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      employee: employeeData,
      tempPassword, // À envoyer par email en production
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Vérifier que c'est un compte principal
    if (!(await isMainAccount(user.id))) {
      return NextResponse.json(
        { error: 'Only main accounts can delete members' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('id')

    if (!employeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      )
    }

    // Ne pas permettre la suppression du compte principal
    if (employeeId === user.id) {
      return NextResponse.json(
        { error: 'Cannot delete main account' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Vérifier que l'employé appartient à ce compte principal
    const { data: employee, error: checkError } = await supabase
      .from('employees')
      .select('*')
      .eq('main_account_id', user.id)
      .eq('employee_id', employeeId)
      .single()

    if (checkError || !employee) {
      return NextResponse.json(
        { error: 'Employee not found or access denied' },
        { status: 404 }
      )
    }

    // Supprimer l'entrée dans employees
    const { error: deleteError } = await supabase
      .from('employees')
      .delete()
      .eq('id', employee.id)

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      )
    }

    // Note: La suppression de l'utilisateur dans auth.users nécessite la service role key
    // Pour l'instant, on supprime seulement l'entrée dans employees
    // L'utilisateur auth restera mais ne pourra plus accéder à l'application
    // En production, utilisez la service role key pour supprimer complètement l'utilisateur

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

