package main

import (
	"context"
	"fmt"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	firestorepb "cloud.google.com/go/firestore/apiv1/firestorepb"
)

func main() {
	ctx := context.Background()
	utils.NewDatabaseClient(false)

	collection := utils.Db.Client.Collection("2022_draftTokens")
	query := collection.NewAggregationQuery().WithCount("all")

	results, err := query.Get(ctx)
	if err != nil {
		fmt.Println("Error 1")
	}

	count, ok := results["all"]
	if !ok {
		fmt.Println("firestore: couldn't get alias for COUNT from results")
	}

	countValue := count.(*firestorepb.Value)
	fmt.Println(countValue.GetIntegerValue())
}
