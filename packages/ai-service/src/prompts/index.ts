export const SYSTEM_PROMPT = `Eres un asistente bancario amigable. Explicas operaciones financieras en español,
de forma clara y concisa para usuarios finales. No uses jerga técnica.
Responde en máximo 2-3 oraciones.`;

export const Prompts = {
  explainCompleted: (params: {
    type: string;
    amount: number;
    currency: string;
    sourceAccountId?: string;
    targetAccountId?: string;
    description?: string;
  }) => {
    const typeLabel = params.type === 'deposit' ? 'depósito'
      : params.type === 'withdrawal' ? 'retiro'
      : 'transferencia';
    return `Explica esta operación bancaria completada al usuario de forma clara y amigable:
- Tipo: ${typeLabel}
- Monto: ${params.amount} ${params.currency}
- Cuenta origen: ${params.sourceAccountId || 'N/A'}
- Cuenta destino: ${params.targetAccountId || 'N/A'}
${params.description ? `- Descripción: ${params.description}` : ''}
Estado: completada exitosamente`;
  },

  explainRejected: (params: {
    type: string;
    amount: number;
    currency: string;
    reason: string;
  }) => {
    const typeLabel = params.type === 'deposit' ? 'depósito'
      : params.type === 'withdrawal' ? 'retiro'
      : 'transferencia';
    return `Explica al usuario por qué esta operación fue rechazada:
- Tipo: ${typeLabel}
- Monto: ${params.amount} ${params.currency}
- Motivo técnico: ${params.reason}
Genera un mensaje claro y empático en español.`;
  },

  summarizeAccount: (params: {
    accountId: string;
    totalDeposits: number;
    totalWithdrawals: number;
    totalTransfersOut: number;
    totalTransfersIn: number;
    totalTransactions: number;
    rejected: number;
  }) => `Resume el historial de transacciones de la cuenta ${params.accountId}:
- Total de transacciones: ${params.totalTransactions}
- Depósitos completados: ${params.totalDeposits.toFixed(2)}
- Retiros completados: ${params.totalWithdrawals.toFixed(2)}
- Transferencias enviadas: ${params.totalTransfersOut.toFixed(2)}
- Transferencias recibidas: ${params.totalTransfersIn.toFixed(2)}
- Transacciones rechazadas: ${params.rejected}
Genera un resumen breve y amigable en español.`,

  translateEvent: (eventSubject: string, eventData: Record<string, unknown>) =>
    `Traduce este evento técnico bancario a un mensaje amigable para el usuario final.
Evento: ${eventSubject}
Datos: ${JSON.stringify(eventData, null, 2)}
Genera un mensaje breve y claro en español.`,

  analyzeRisk: (params: {
    type: string;
    amount: number;
    currency: string;
    sourceAccountId?: string;
    targetAccountId?: string;
    accountBalance?: number;
    recentTransactionCount?: number;
    description?: string;
  }) => `Analiza el riesgo de esta transacción bancaria y responde en JSON con el siguiente formato exacto:
{"riskLevel":"low"|"medium"|"high","score":0-100,"reasons":["..."],"recommendation":"..."}

Transacción:
- Tipo: ${params.type}
- Monto: ${params.amount} ${params.currency}
- Cuenta origen: ${params.sourceAccountId || 'N/A'}
- Cuenta destino: ${params.targetAccountId || 'N/A'}
${params.accountBalance !== undefined ? `- Saldo disponible: ${params.accountBalance} ${params.currency}` : ''}
${params.recentTransactionCount !== undefined ? `- Transacciones recientes (24h): ${params.recentTransactionCount}` : ''}
${params.description ? `- Descripción: ${params.description}` : ''}

Considera: monto inusual, frecuencia, proporción respecto al saldo, patrones de fraude comunes.`,
};
