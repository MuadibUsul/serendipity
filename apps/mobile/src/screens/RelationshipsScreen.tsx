import { SPACE } from "@serendipity/ui";
import { View } from "react-native";

import type { Home } from "../api/types";
import { RELATIONSHIPS_PAGE } from "../copy";
import { formatDay } from "../format";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Glass } from "../ui/Glass";
import { Illustration } from "../ui/Illustration";
import { EmptyState, Screen } from "../ui/Screen";

/** Only people both sides chose to continue with after meeting (PRD-001 §7). */
export function RelationshipsScreen({ home }: { readonly home: Home }) {
  return (
    <Screen>
      {home.relationships.length === 0 ? (
        <EmptyState
          art={<Illustration name="threads" />}
          line={RELATIONSHIPS_PAGE.empty}
          hint={RELATIONSHIPS_PAGE.emptyHint}
        />
      ) : (
        home.relationships.map((relationship) => (
          <Glass key={relationship.id} style={{ padding: SPACE.xl, gap: SPACE.lg }}>
            <View style={{ gap: SPACE.xs }}>
              <AppText variant="title" heading>
                {relationship.sharedName}
              </AppText>
              <AppText variant="subhead" color="textSecondary">
                {RELATIONSHIPS_PAGE.metOn(formatDay(relationship.metOn))}
              </AppText>
            </View>
            <View style={{ flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" }}>
              {/* Chat arrives with ser-p05-02, safety with ser-p05-05. */}
              <View style={{ flexGrow: 1 }}>
                <Button
                  label={RELATIONSHIPS_PAGE.chat}
                  spokenLabel={`${RELATIONSHIPS_PAGE.chat}：${relationship.sharedName}`}
                  disabled
                />
              </View>
              <View style={{ flexGrow: 1 }}>
                <Button
                  label={RELATIONSHIPS_PAGE.block}
                  spokenLabel={`${RELATIONSHIPS_PAGE.block}：${relationship.sharedName}`}
                  variant="secondary"
                  disabled
                />
              </View>
            </View>
          </Glass>
        ))
      )}
    </Screen>
  );
}
