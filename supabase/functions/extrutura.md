O que o user-api NÃO cobre (funções independentes que devem continuar separadas)

Arquivo                         Motivo para manter

separadostripe-webhookRecebe    chamadas do Stripe diretamente, sem auth de usuário. Deve ter URL pública própria
expire-trialsJob                noturno agendado (cron), não é chamado pelo frontend
unlock-commissions              Idem — job agendado
stripe-connect                  Fluxo de onboarding de contas Connect — poderia ser absorvido, mas é isolado o suficiente
create-user                     Chamado por admin/manager para criar outros usuários
promote-to-admin                Utilitário admin pontual
get-secretsDeve                 ser deletado, não modulado
mock-stripe                     Deve ser desativado em produção
contact-support                 Formulário público, sem auth de usuário
reset-password                  (admin)Chamado por admin para resetar senha de outro usuário


supabase/functions/
├── user-api/index.ts        ← tudo do usuário final (modularize aqui)
├── stripe-webhook/index.ts  ← manter separado
├── stripe-connect/index.ts  ← manter separado (ou absorver no user-api)
├── expire-trials/index.ts   ← manter separado (cron)
├── unlock-commissions/index.ts ← manter separado (cron)
├── create-user/index.ts     ← manter separado (admin)
├── contact-support/index.ts ← manter separado (público, sem auth)
└── [deletar] get-secrets, promote-to-admin, mock-stripe