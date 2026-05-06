package models

import (
	"fmt"
	"strconv"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

type DraftQueue []PlayerStateInfo
type DraftQueueMap map[string]PlayerStateInfo

func UpdateQueueForDraft(draftId string, user string, queue DraftQueue) error {
	fmt.Println("Updating Queue")
	// turn queue into a map for firebase
	draftQueueMap := make(DraftQueueMap)
	for i := 0; i < len(queue); i++ {
		draftQueueMap[strconv.Itoa(i)] = queue[i]
	}

	err := utils.Db.CreateOrUpdateDocument(fmt.Sprintf("drafts/%s/state/draftQueues/%s", draftId, user), "Players", &draftQueueMap)
	if err != nil {
		fmt.Println(err)
		return err
	}
	return nil
}

func FetchQueueForDrafter(draftId string, user string) (DraftQueue, error) {
	draftQueueMap := make(DraftQueueMap)

	err := utils.Db.ReadDocument(fmt.Sprintf("drafts/%s/state/draftQueues/%s", draftId, user), "Players", &draftQueueMap)
	if err != nil {
		fmt.Println(err)
		return nil, err
	}

	// turn it into DraftQueue object
	numberOfItems := len(draftQueueMap)
	queue := make(DraftQueue, numberOfItems)
	for k, v := range draftQueueMap {
		// assign queue by index
		i, err := strconv.Atoi(k)
		if err != nil {
			fmt.Println(err)
			return nil, err
		}
		fmt.Println(i)
		queue[i] = v
	}

	return queue, nil
}