import { SPACE } from "@serendipity/ui";
import { View } from "react-native";

import type { Home } from "../api/types";
import { RELATIONSHIPS_PAGE } from "../copy";
import { AppText } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Card, Screen } from "../ui/Screen";

/** Only people both sides chose to continue with after meeting (PRD-001 §7). */
export function RelationshipsScreen({ home }: { readonly home: Home }) {
  return (
    <Screen>
      <AppText variant="title" heading>
        {RELATIONSHIPS_PAGE.title}
      </AppText>
      {home.relationships.length === 0 ? (
        <Card>
          <AppText color="textMuted">{RELATIONSHIPS_PAGE.empty}</AppText>
        </Card>
      ) : (
        home.relationships.map((relationship) => (
          <Card key={relationship.id}>
            <AppText variant="heading" heading>
              {relationship.sharedName}
            </AppText>
            <AppText color="textMuted">{RELATIONSHIPS_PAGE.metOn(relationship.metOn)}</AppText>
            <View style={{ gap: SPACE.sm }}>
              {/* Chat arrives with ser-p05-02, safety with ser-p05-05. */}
              <Button label={`${RELATIONSHIPS_PAGE.chat}：${relationship.sharedName}`} disabled />
              <Button
                label={`${RELATIONSHIPS_PAGE.block}：${relationship.sharedName}`}
                variant="secondary"
                disabled
              />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
