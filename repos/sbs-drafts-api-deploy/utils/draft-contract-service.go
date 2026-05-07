package utils

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/api"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

type DraftTokenContract struct {
	EthConn *ethclient.Client
	Api     *api.ApiCaller
}

var Contract *DraftTokenContract

func CreateEthConnection(contractAddress string, infuraEndpoint string) error {
	contractAddr := common.HexToAddress(contractAddress)

	conn, err := ethclient.Dial(infuraEndpoint)
	if err != nil {
		return err
	}

	contract, err := api.NewApiCaller(contractAddr, conn)
	if err != nil {
		return err
	}

	con := &DraftTokenContract{
		EthConn: conn,
		Api:     contract,
	}

	Contract = con
	return nil
}

func (c *DraftTokenContract) GetOwnerOfToken(tokenId int) (string, error) {
	id := big.NewInt(int64(tokenId))
	owner, err := c.Api.OwnerOf(nil, id)
	if err != nil {
		return "", err
	}
	fmt.Println("Returning from getting owner from token Id")
	return strings.ToLower(owner.Hex()), nil
}

func (c *DraftTokenContract) GetNumTokensMinted() (int, error) {
	res, err := c.Api.NumTokensMinted(nil)
	if err != nil {
		return -1, nil
	}
	return int(res.Int64()), nil
}
