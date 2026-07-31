import boardData from '@/docs/luna/board.json';
import { requireRole } from '@/lib/auth/requireRole';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const STATUS_COLUMNS = [
  { id: 'ready', label: 'Ready', className: styles.statusReady },
  { id: 'active', label: 'Active', className: styles.statusActive },
  { id: 'review', label: 'Review', className: styles.statusReview },
  { id: 'blocked', label: 'Blocked', className: styles.statusBlocked },
  { id: 'done', label: 'Done', className: styles.statusDone },
] as const;

type TicketStatus = (typeof STATUS_COLUMNS)[number]['id'];
type Ticket = (typeof boardData.tickets)[number];

function countTickets(status: TicketStatus): number {
  return boardData.tickets.filter((ticket) => ticket.status === status).length;
}

function statusClass(status: TicketStatus): string {
  return STATUS_COLUMNS.find((column) => column.id === status)?.className ?? '';
}

export default async function LunaBoardPage() {
  await requireRole('manager');

  const readyCount = countTickets('ready');
  const activeCount = countTickets('active');
  const blockedCount = countTickets('blocked');
  const humanGateCount = boardData.tickets.filter(
    (ticket) => ticket.humanGate && ticket.status !== 'done',
  ).length;

  return (
    <section className={styles.page} aria-labelledby="luna-board-title">
      <header className={styles.masthead}>
        <div>
          <p className={styles.kicker}>Luna operations · source-controlled queue</p>
          <h1 className={styles.title} id="luna-board-title">
            The whole table, face up.
          </h1>
          <p className={styles.lede}>
            Every project ticket is assigned, dependency-aware, and paired with a verifiable
            definition of done. Luna workers take ready cards by wave; validators move reviewed work
            to done.
          </p>
        </div>
        <aside className={styles.snapshot} aria-label="Board snapshot">
          <span className={styles.microLabel}>Status reconciled</span>
          <strong>{boardData.snapshotAt}</strong>
          <p>{boardData.sourceNote}</p>
        </aside>
      </header>

      <section className={styles.metrics} aria-label="Queue summary">
        <div className={styles.metric}>
          <span className={styles.metricValue}>{readyCount}</span>
          <span className={styles.metricLabel}>Ready to deal</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{activeCount}</span>
          <span className={styles.metricLabel}>Active workers</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{blockedCount}</span>
          <span className={styles.metricLabel}>Blocked tickets</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{humanGateCount}</span>
          <span className={styles.metricLabel}>Need owner access</span>
        </div>
      </section>

      <section className={styles.waveRail} aria-label="Execution waves">
        {boardData.waves.map((wave) => (
          <article className={styles.wave} key={wave.id}>
            <span className={styles.waveIndex}>Wave {wave.id}</span>
            <h2 className={styles.waveName}>{wave.name}</h2>
            <p className={styles.waveGoal}>{wave.goal}</p>
          </article>
        ))}
      </section>

      <div className={styles.boardHeading}>
        <h2>Assigned kanban</h2>
        <p>{boardData.tickets.length} tickets · acceptance checks stay visible on every card</p>
      </div>

      <div className={styles.board} aria-label="Luna ticket board">
        {STATUS_COLUMNS.map((column) => {
          const tickets = boardData.tickets.filter((ticket) => ticket.status === column.id);
          return (
            <section
              className={`${styles.column} ${column.className}`}
              aria-labelledby={`column-${column.id}`}
              key={column.id}
            >
              <header className={styles.columnHeader}>
                <h3 className={styles.columnTitle} id={`column-${column.id}`}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  {column.label}
                </h3>
                <span className={styles.columnCount}>{tickets.length}</span>
              </header>

              {tickets.length === 0 ? (
                <p className={styles.empty}>No tickets in this lane.</p>
              ) : (
                <div className={styles.ticketList}>
                  {tickets.map((ticket) => (
                    <TicketCard ticket={ticket} key={ticket.id} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const dependencies = ticket.blockedBy.length === 0 ? ['None'] : ticket.blockedBy;

  return (
    <article className={`${styles.ticket} ${statusClass(ticket.status as TicketStatus)}`}>
      <header className={styles.ticketHeader}>
        <div className={styles.ticketMeta}>
          <span className={styles.ticketId}>
            {ticket.id} · W{ticket.wave}
          </span>
          <span className={styles.priority}>{ticket.priority}</span>
        </div>
        <h4 className={styles.ticketTitle}>{ticket.title}</h4>
        <p className={styles.summary}>{ticket.summary}</p>
      </header>

      <div className={styles.assignment}>
        <div className={styles.agent}>
          <span className={styles.agentMark} aria-hidden="true">
            L
          </span>
          <span>
            <span className={styles.agentName}>{ticket.assignee}</span>
            <span className={styles.agentRole}>{ticket.agentRole}</span>
          </span>
        </div>
        {ticket.humanGate ? (
          <span className={styles.gate}>Human gate</span>
        ) : (
          <span className={styles.badge}>Agent-safe</span>
        )}
      </div>

      <div className={styles.ticketBody}>
        <section>
          <span className={styles.sectionLabel}>Next action</span>
          <p className={styles.nextAction}>{ticket.nextAction}</p>
        </section>

        <section>
          <span className={styles.sectionLabel}>Definition of done</span>
          <ul className={styles.criteria}>
            {ticket.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </section>

        <section>
          <span className={styles.sectionLabel}>Blocked by</span>
          <ul className={styles.dependencies}>
            {dependencies.map((dependency) => (
              <li key={dependency}>{dependency}</li>
            ))}
          </ul>
        </section>

        {ticket.evidence.length > 0 ? (
          <section>
            <span className={styles.sectionLabel}>Evidence</span>
            <ul className={styles.evidence}>
              {ticket.evidence.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}
