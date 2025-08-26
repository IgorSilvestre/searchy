import { IntrospectionAdapter, RelationCard } from "../adapters/db";

export async function buildCards(adapter: IntrospectionAdapter): Promise<RelationCard[]> {
  const rels = await adapter.listRelations();
  const [cards, fks] = await Promise.all([
    Promise.all(rels.map((r) => adapter.describeRelation(r.name))),
    adapter.listRelationships(),
  ]);

  const fkByFrom = new Map<string, Array<{ from: string; column: string; to: string; toColumn: string }>>();
  for (const fk of fks) {
    const arr = fkByFrom.get(fk.from) || [];
    arr.push(fk);
    fkByFrom.set(fk.from, arr);
  }

  for (const card of cards) {
    const hints: string[] = [];
    const farr = fkByFrom.get(card.name) || [];
    for (const f of farr) {
      hints.push(`${card.name}.${f.column} -> ${f.to}.${f.toColumn}`);
    }
    card.join_hints = hints;
  }
  return cards;
}
