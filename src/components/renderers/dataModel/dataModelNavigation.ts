import type { ParsedEntity } from '../../../lib/services/dataModelMarkdown';

export type DataModelMemberAspect = 'field' | 'relationship' | 'constraint' | 'data_expectation';

const anchorToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member';
const anchorHash = (value: string): string => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(36);
};

export const dataModelMemberAnchorId = (
    entityName: string,
    aspect: DataModelMemberAspect,
    memberName: string,
): string => `data-model-member-${anchorToken(entityName)}-${aspect}-${anchorToken(memberName).slice(0, 48)}-${anchorHash(memberName)}`;

/** Resolve only an exact structured member. Approximate matches deliberately
 * return undefined so legacy or ambiguous targets fall back to the entity. */
export function resolveDataModelMemberAnchor(
    entity: ParsedEntity,
    aspect?: DataModelMemberAspect,
    memberName?: string,
): string | undefined {
    if (!aspect || !memberName) return undefined;
    const found = aspect === 'field'
        ? entity.fieldGroups.some(group => group.fields.some(field => field.name === memberName))
        : entity.callouts.some(callout => callout.text === memberName && (
            aspect === 'relationship' ? callout.kind === 'RELATIONSHIP'
                : aspect === 'constraint' ? callout.kind === 'CONSTRAINT'
                    : callout.kind === 'PRIVACY' || callout.kind === 'INDEX'
        ));
    return found ? dataModelMemberAnchorId(entity.name, aspect, memberName) : undefined;
}
